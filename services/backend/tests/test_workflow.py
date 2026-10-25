import io

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select

from app.main import app
from app.models import Release
from conftest import login


def draft_payload():
    return {
        "name": "Địa điểm thử nghiệm",
        "category_id": "test-category",
        "address": "Quận 1",
        "translations": {
            "vi": {"title": "Tiếng Việt", "text": "Nội dung kiểm thử."},
            "en": {"title": "English", "text": "Test narration."},
        },
    }


def image_bytes():
    result = io.BytesIO()
    Image.new("RGB", (20, 20)).save(result, format="PNG")
    return result.getvalue()


def create(client, name=None):
    payload = draft_payload()
    if name:
        payload["name"] = name
    response = client.post("/api/v1/admin/pois", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def upload(client, poi):
    response = client.post(
        f"/api/v1/admin/pois/{poi['id']}/upload",
        params={"kind": "image", "revision": poi["revision"]},
        files={"file": ("cover.png", image_bytes(), "image/png")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def action(client, poi, name, **kwargs):
    return client.post(
        f"/api/v1/admin/pois/{poi['id']}/actions",
        json={"revision": poi["revision"], "action": name, "confirmed_review": name == "approve", **kwargs},
    )


def ready(client):
    return create(client)


def publish(client, poi):
    login(client, "editor")
    assert action(client, poi, "publish").status_code == 403
    login(client, "admin")
    poi = action(client, poi, "submit").json()
    login(client, "admin")
    poi = action(client, poi, "approve").json()
    response = action(client, poi, "publish")
    assert response.status_code == 200, response.text
    return response.json()


def test_anonymous_cannot_read_drafts_or_private_media(env):
    client, _, _ = env
    assert client.get("/api/v1/admin/pois").status_code == 401
    login(client, "admin")
    poi = upload(client, create(client))
    image_id = poi["image_id"]
    assert client.get(f"/api/v1/media/{image_id}").status_code == 200
    client.post("/api/v1/auth/logout")
    assert client.get(f"/api/v1/pois/{poi['id']}").status_code == 404
    assert client.get(f"/api/v1/media/{image_id}").status_code == 404
    assert client.get("/api/v1/pois").json()["items"] == []


def test_full_bilingual_workflow_needs_only_text(env):
    from app.models import Media, PoiTranslation

    client, factory, directory = env
    login(client, "admin")
    poi = publish(client, ready(client))
    client.post("/api/v1/auth/logout")
    for locale in ("vi", "en"):
        public = client.get(f"/api/v1/pois/{poi['id']}?locale={locale}")
        assert public.status_code == 200
        tr = public.json()["translations"][locale]
        assert tr["tts_ready"] and tr["text"]
        assert "audio_id" not in tr
    with factory() as db:
        assert not list(db.scalars(select(Media)))
        assert len(list(db.scalars(select(PoiTranslation)))) == 2
    assert not list(directory.glob("*.wav"))
    assert len(client.get("/api/v1/pois").json()["items"]) == 1


def test_required_languages_and_text_edits_need_no_audio(env):
    client, _, _ = env
    login(client, "admin")
    payload = draft_payload()
    payload["translations"]["en"]["text"] = ""
    poi = client.post("/api/v1/admin/pois", json=payload).json()
    assert action(client, poi, "submit").status_code == 422
    payload = draft_payload()
    payload["revision"] = poi["revision"]
    payload["translations"]["vi"]["text"] = "Nội dung đã thay đổi."
    poi = client.put(f"/api/v1/admin/pois/{poi['id']}", json=payload).json()
    assert poi["translations"]["vi"]["tts_ready"] is True
    assert action(client, poi, "submit").status_code == 200


def test_saving_draft_preserves_public_snapshot_and_release_history(env):
    client, factory, _ = env
    login(client, "admin")
    poi = publish(client, ready(client))
    old_public = client.get(f"/api/v1/pois/{poi['id']}").json()
    payload = draft_payload()
    payload.update(name="Tên nháp mới", revision=poi["revision"])
    changed = client.put(f"/api/v1/admin/pois/{poi['id']}", json=payload)
    assert changed.status_code == 200
    assert changed.json()["status"] == "draft"
    assert client.get(f"/api/v1/pois/{poi['id']}").json() == old_public
    with factory() as db:
        from app.content import text_snapshot
        assert text_snapshot(db.scalar(select(Release)).snapshot) == old_public


def test_reviewer_feedback_stays_private_after_admin_republishes_and_for_legacy_snapshots(env):
    client, factory, _ = env
    login(client, "admin")
    poi = action(client, create(client), "submit").json()
    private_note = "Ghi chú nội bộ: cần đối chiếu tài liệu chưa công bố."
    poi = action(client, poi, "reject", note=private_note).json()
    published = client.put(f"/api/v1/admin/pois/{poi['id']}",
        json=draft_payload() | {"revision": poi["revision"], "status": "published"})
    assert published.status_code == 200
    assert published.json()["note"] == private_note
    for legacy in (False, True):
        if legacy:
            with factory() as db:
                release = db.scalar(select(Release).where(Release.poi_id == poi["id"]))
                assert release.snapshot["note"] == private_note
                snapshot = dict(release.snapshot)
                snapshot.pop("published_language_codes", None)
                release.snapshot = snapshot
                db.commit()
        client.post("/api/v1/auth/logout")
        detail = client.get(f"/api/v1/pois/{poi['id']}?track_view=false").json()
        listing = client.get("/api/v1/pois").json()["items"]
        assert "note" not in detail
        assert private_note not in str(detail) + str(listing)
        assert all("note" not in item for item in listing)
        login(client, "admin")
        assert client.get(f"/api/v1/admin/pois/{poi['id']}").json()["note"] == private_note


def test_stale_admin_cannot_overwrite_newer_revision(env):
    client, _, _ = env
    login(client, "admin")
    poi = create(client)
    payload = draft_payload() | {"revision": poi["revision"]}
    assert client.put(f"/api/v1/admin/pois/{poi['id']}", json=payload).status_code == 200
    assert client.put(f"/api/v1/admin/pois/{poi['id']}", json=payload).status_code == 409
    assert action(client, poi, "submit").status_code == 409


def test_review_locks_edits_and_rejection_requires_reason(env):
    client, _, _ = env
    login(client, "admin")
    poi = action(client, ready(client), "submit").json()
    assert (
        client.put(
            f"/api/v1/admin/pois/{poi['id']}", json=draft_payload() | {"revision": poi["revision"]}
        ).status_code
        == 409
    )
    login(client, "editor")
    assert action(client, poi, "approve").status_code == 403
    login(client, "reviewer")
    assert action(client, poi, "reject").status_code == 403
    login(client, "admin")
    assert action(client, poi, "reject").status_code == 422
    rejected = action(client, poi, "reject", note="Kiểm tra lại nội dung.")
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "draft"
    assert rejected.json()["note"] == "Kiểm tra lại nội dung."


def test_malformed_and_mislabelled_uploads_are_rejected(env):
    client, _, directory = env
    login(client, "admin")
    poi = create(client)
    url = f"/api/v1/admin/pois/{poi['id']}/upload?kind=audio&revision={poi['revision']}"
    assert client.post(url, files={"file": ("fake.mp3", b"not audio", "audio/mpeg")}).status_code == 422
    assert client.post(url, files={"file": ("wrong.mp3", image_bytes(), "audio/mpeg")}).status_code == 422
    assert not list(directory.glob("*.wav"))
    image_url = url.replace("kind=audio", "kind=image")
    assert (
        client.post(
            image_url, files={"file": ("x.svg", b'<svg onload="alert(1)"/>', "image/svg+xml")}
        ).status_code
        == 422
    )
    image = io.BytesIO()
    Image.new("RGB", (20, 20)).save(image, format="PNG")
    assert (
        client.post(image_url, files={"file": ("image.png", image.getvalue(), "image/png")}).status_code
        == 200
    )


def test_logout_revokes_session_and_csrf_header_is_required(env):
    client, _, _ = env
    login(client, "admin")
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401
    with TestClient(app) as anonymous:
        assert (
            anonymous.post(
                "/api/v1/auth/login", json={"email": "editor@test.local", "password": "test-password"}
            ).status_code
            == 403
        )


def test_archive_hides_public_place_and_can_restore_new_draft(env):
    client, _, _ = env
    login(client, "admin")
    poi = publish(client, ready(client))
    poi = action(client, poi, "archive").json()
    assert client.get(f"/api/v1/pois/{poi['id']}").status_code == 404
    history = client.get(f"/api/v1/admin/pois/{poi['id']}/history").json()
    restored = action(client, poi, "restore", release_id=history["releases"][0]["id"])
    assert restored.status_code == 200
    assert restored.json()["status"] == "draft"
    assert restored.json()["revision"] > poi["revision"]
    assert len(history["releases"]) == 1
    assert client.get(f"/api/v1/pois/{poi['id']}").status_code == 404


def test_accent_insensitive_search_and_pagination(env):
    client, _, _ = env
    login(client, "admin")
    create(client)
    response = client.get("/api/v1/admin/pois?q=dia+diem&page_size=1")
    assert response.json()["total"] == 1
    assert len(response.json()["items"]) == 1
    assert client.get("/api/v1/admin/pois?q=doesnotexist").json()["total"] == 0
    assert client.get("/api/v1/admin/pois?page=0").status_code == 422


def test_category_delete_requires_admin_and_empty_category(env):
    client, _, _ = env
    login(client, "editor")
    assert client.delete("/api/v1/admin/categories/test-category").status_code == 403
    login(client, "admin")
    create(client)
    login(client, "admin")
    assert client.delete("/api/v1/admin/categories/test-category").status_code == 409
    category = client.post("/api/v1/admin/categories", json={"name": "Empty", "name_vi": "Trống"}).json()
    assert client.delete(f"/api/v1/admin/categories/{category['id']}").status_code == 204


def test_cannot_restore_another_places_release(env):
    client, _, _ = env
    login(client, "admin")
    poi = publish(client, ready(client))
    history = client.get(f"/api/v1/admin/pois/{poi['id']}/history").json()
    another = client.post("/api/v1/admin/pois", json=draft_payload() | {"name": "Một địa điểm khác"}).json()
    assert action(client, another, "restore", release_id=history["releases"][0]["id"]).status_code == 404


def test_demo_seed_is_repeatable_and_preserves_editor_changes(env, monkeypatch):
    from app import seed as seed_module
    from app.models import Poi

    _, factory, _ = env
    monkeypatch.setattr(seed_module, "SessionLocal", factory)
    seed_module.seed()
    with factory() as db:
        first = db.get(Poi, "demo-01")
        first.name = "Nội dung do người dùng chỉnh sửa"
        db.commit()
    seed_module.seed()
    with factory() as db:
        assert len(list(db.scalars(select(Poi)))) == 12
        assert db.get(Poi, "demo-01").name == "Nội dung do người dùng chỉnh sửa"
        assert all(p.status == "draft" and p.is_demo for p in db.scalars(select(Poi)))
