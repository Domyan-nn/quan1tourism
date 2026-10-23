from sqlalchemy import select

from app.models import Language, PoiTranslation
from conftest import login
from test_workflow import action, create, draft_payload, publish


def language_payload(**changes):
    return {
        "code": "ms",
        "name": "Malay",
        "native_name": "Bahasa Melayu",
        "speech_locale": "ms-MY",
        **changes,
    }


def test_registry_is_seeded_by_migration_and_admin_controls_it(env):
    client, _, _ = env
    languages = client.get("/api/v1/languages").json()
    assert len(languages) == 15
    assert {item["code"] for item in languages if item["required"]} == {"vi", "en"}
    assert next(item for item in languages if item["code"] == "ar")["direction"] == "rtl"
    url = "/api/v1/admin/languages"
    assert client.post(url, json=language_payload()).status_code == 401
    login(client)
    assert client.get(url).status_code == 200
    assert client.post(url, json=language_payload()).status_code == 403
    login(client, "admin")
    assert client.post(url, json=language_payload()).status_code == 201
    assert client.post(url, json=language_payload()).status_code == 409
    assert client.post(url, json=language_payload(code="bad code")).status_code == 422
    assert (
        client.post(url, json=language_payload(code="ms-MY", speech_locale="ms-my")).json()["speech_locale"]
        == "ms-MY"
    )
    vi = languages[0]
    assert client.put(f"{url}/vi", json=vi | {"enabled": False, "required": False}).status_code == 422


def test_new_language_works_without_code_changes_and_hides_when_disabled(env):
    client, factory, _ = env
    login(client, "admin")
    language = client.post("/api/v1/admin/languages", json=language_payload()).json()
    login(client)
    payload = draft_payload()
    payload["translations"]["ms"] = {"title": "Kisah Saigon", "text": "Selamat datang ke Saigon."}
    poi = client.post("/api/v1/admin/pois", json=payload).json()
    with factory() as db:
        assert db.get(PoiTranslation, (poi["id"], "ms")).text == "Selamat datang ke Saigon."
    poi = publish(client, poi)
    assert client.get(f"/api/v1/pois/{poi['id']}?locale=ms").json()["translations"]["ms"]["tts_ready"]
    login(client, "admin")
    assert client.put("/api/v1/admin/languages/ms", json=language | {"enabled": False}).status_code == 200
    assert "ms" not in {item["code"] for item in client.get("/api/v1/languages").json()}
    assert client.get(f"/api/v1/pois/{poi['id']}?locale=ms").status_code == 422
    assert client.get(f"/api/v1/admin/pois/{poi['id']}").json()["translations"]["ms"]["text"]
    assert client.put("/api/v1/admin/languages/ms", json=language).status_code == 200
    assert client.get(f"/api/v1/pois/{poi['id']}?locale=ms").status_code == 200


def test_unknown_missing_and_partial_translations_do_not_leak_or_publish(env):
    client, _, _ = env
    login(client)
    payload = draft_payload()
    payload["translations"]["xx"] = {"title": "Unknown", "text": "Unknown"}
    assert client.post("/api/v1/admin/pois", json=payload).status_code == 422
    payload["translations"].pop("xx")
    payload["translations"]["fr"] = {"title": "Titre", "text": ""}
    poi = client.post("/api/v1/admin/pois", json=payload).json()
    assert action(client, poi, "submit").status_code == 422
    assert client.get("/api/v1/pois?locale=xx").status_code == 422
    assert client.get(f"/api/v1/pois/{poi['id']}?locale=fr").status_code == 404


def test_required_language_is_data_and_partial_updates_keep_other_translations(env):
    client, factory, _ = env
    login(client, "admin")
    language = client.post("/api/v1/admin/languages", json=language_payload(required=True)).json()
    login(client)
    poi = create(client)
    assert action(client, poi, "submit").status_code == 422
    poi = client.put(
        f"/api/v1/admin/pois/{poi['id']}",
        json=draft_payload()
        | {
            "revision": poi["revision"],
            "translations": {"ms": {"title": "Kisah", "text": "Selamat datang."}},
        },
    ).json()
    assert poi["translations"]["vi"]["text"]
    assert action(client, poi, "submit").status_code == 200
    login(client, "admin")
    assert client.put("/api/v1/admin/languages/ms", json=language | {"enabled": False}).status_code == 422
    with factory() as db:
        assert len(list(db.scalars(select(Language)))) == 16
