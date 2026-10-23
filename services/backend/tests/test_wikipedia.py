import json
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app import wikipedia
from app.models import Poi
from conftest import login
from test_workflow import action

URL = "https://vi.wikipedia.org/wiki/Nh%C3%A0_V%C4%83n_h%C3%B3a_Thanh_ni%C3%AAn"
TITLE = "Nhà Văn hóa Thanh niên"
ARTICLE = (
    "Nhà Văn hóa Thanh niên là trung tâm sinh hoạt của thanh niên thành phố. "
    "Cổng chính được đánh địa chỉ số 4 Phạm Ngọc Thạch. "
    "Khuôn viên có hội trường, sân thể thao và các câu lạc bộ thanh niên."
)


@pytest.fixture()
def upstream(monkeypatch):
    state = {
        "coordinates": True,
        "image": True,
        "bad_json": False,
        "truncated": False,
        "bad_address": False,
        "calls": [],
    }

    def fetch(url, *, payload=None, **kwargs):
        state["calls"].append((url, payload))
        if url.endswith("/api/tags"):
            return {"models": [{"name": wikipedia.OLLAMA_MODEL}]}
        if url.endswith("/api/chat"):
            codes = payload["format"]["properties"]["translations"]["required"]
            value = {
                "address": "999 Đường không có thật" if state["bad_address"] else "4 Phạm Ngọc Thạch",
                "address_evidence": "Cổng chính được đánh địa chỉ số 4 Phạm Ngọc Thạch.",
                "category_id": "test-category",
                "translations": {
                    code: {"title": TITLE, "text": "Nội dung thuyết minh được tóm lược từ bài viết."}
                    for code in codes
                },
                "warnings": ["Kiểm chứng địa chỉ hành chính trước khi xuất bản."],
            }
            return {
                "done": True,
                "done_reason": "length" if state["truncated"] else "stop",
                "total_duration": 2_000_000_000,
                "message": {"content": "{bad" if state["bad_json"] else json.dumps(value)},
            }
        if "wikidata.org" in url:
            claims = {}
            if state["coordinates"]:
                claims["P625"] = [
                    {
                        "mainsnak": {
                            "snaktype": "value",
                            "datavalue": {
                                "value": {
                                    "latitude": 10.782,
                                    "longitude": 106.697,
                                    "globe": "http://www.wikidata.org/entity/Q2",
                                }
                            },
                        }
                    }
                ]
            if state["image"]:
                claims["P18"] = [
                    {"mainsnak": {"snaktype": "value", "datavalue": {"value": "Youth-center.jpg"}}}
                ]
            return {"entities": {"Q10800798": {"claims": claims}}}
        if "commons.wikimedia.org" in url:
            return {
                "query": {
                    "pages": [
                        {
                            "imageinfo": [
                                {
                                    "thumburl": "https://upload.wikimedia.org/wikipedia/commons/a/ab/Youth-center.jpg",
                                    "descriptionurl": "https://commons.wikimedia.org/wiki/File:Youth-center.jpg",
                                    "extmetadata": {
                                        "LicenseShortName": {"value": "CC BY-SA 4.0"},
                                        "Artist": {"value": "<a href='/'>Test Author</a>"},
                                    },
                                }
                            ]
                        }
                    ]
                }
            }
        params = parse_qs(urlsplit(url).query)
        assert params["action"] == ["query"]
        return {
            "query": {
                "pages": [
                    {
                        "ns": 0,
                        "title": TITLE,
                        "extract": ARTICLE,
                        "lastrevid": 123,
                        "pageprops": {"wikibase_item": "Q10800798"},
                        "canonicalurl": URL,
                    }
                ]
            }
        }

    monkeypatch.setattr(wikipedia, "fetch_json", fetch)
    return state


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.example/wiki/Test",
        "https://vi.wikipedia.org.evil.example/wiki/Test",
        "https://user:pass@vi.wikipedia.org/wiki/Test",
        "https://vi.wikipedia.org:443/wiki/Test",
        "http://127.0.0.1:5432/wiki/Test",
        "file:///wiki/Test",
        "https://vi.wikipedia.org/wiki/File:Test",
        "https://vi.wikipedia.org/",
        "https://vi.wikipedia.org/wiki/%00Test",
    ],
)
def test_only_wikipedia_articles_are_accepted(url, monkeypatch):
    monkeypatch.setattr(
        wikipedia, "fetch_json", lambda *args, **kwargs: pytest.fail("Unexpected network access")
    )
    with pytest.raises(HTTPException) as error:
        wikipedia.get_article(url)
    assert error.value.status_code == 422


def test_normalizes_mobile_encoded_and_index_links():
    first = wikipedia.normalize_wikipedia_url(
        "https://vi.m.wikipedia.org/wiki/Nh%C3%A0_V%C4%83n_h%C3%B3a#Vị_trí"
    )
    second = wikipedia.normalize_wikipedia_url(
        "http://vi.wikipedia.org/w/index.php?title=Nh%C3%A0_V%C4%83n_h%C3%B3a"
    )
    assert first == second
    assert first[0] == "vi.wikipedia.org" and first[1] == "Nhà Văn hóa"


def test_address_is_a_street_address_and_administrative_conflicts_are_not_left_to_ai():
    sentence = "Cổng chính được đánh địa chỉ số 4 Phạm Ngọc Thạch"
    assert wikipedia.verified_address(sentence, ARTICLE) == "4 Phạm Ngọc Thạch"
    assert wikipedia.verified_address("999 Đường không có thật", ARTICLE) == "4 Phạm Ngọc Thạch"
    warnings = wikipedia.administrative_warnings(
        "Nằm tại phường Sài Gòn, thành phố. Thuộc Phường Bến Nghé, Quận 1."
    )
    assert len(warnings) == 1 and "Sài Gòn" in warnings[0] and "Bến Nghé" in warnings[0]


def test_ai_requires_staff_and_does_not_fetch_for_visitors(env, upstream):
    client, _, _ = env
    assert client.get("/api/v1/admin/ai/status").status_code == 401
    assert client.post("/api/v1/admin/ai/wikipedia", json={"url": URL}).status_code == 401
    assert (
        client.post(
            "/api/v1/auth/register",
            json={"name": "Visitor", "email": "visitor@test.local", "password": "visitor-password"},
        ).status_code
        == 201
    )
    assert client.post("/api/v1/admin/ai/wikipedia", json={"url": URL}).status_code == 403
    assert not upstream["calls"]


def test_generate_review_save_and_publish_keep_sources(env, upstream):
    client, factory, _ = env
    login(client)
    assert client.get("/api/v1/admin/ai/status").json()["ready"]
    response = client.post("/api/v1/admin/ai/wikipedia", json={"url": URL, "language_codes": ["fr"]})
    assert response.status_code == 200, response.text
    preview = response.json()
    payload = preview["draft"]
    assert set(payload["translations"]) == {"vi", "en", "fr"}
    assert payload["latitude"] == 10.782 and payload["longitude"] == 106.697
    assert payload["source"]["coordinate_source"] == "https://www.wikidata.org/wiki/Q10800798"
    assert payload["source"]["image_author"] == "Test Author"
    assert payload["source"]["image_license"] == "CC BY-SA 4.0"
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Poi)) == 0
    created = client.post("/api/v1/admin/pois", json=payload)
    assert created.status_code == 201, created.text
    poi = created.json()
    assert poi["status"] == "draft" and poi["source"] == payload["source"]
    assert client.get(f"/api/v1/pois/{poi['id']}").status_code == 404
    assert client.post("/api/v1/admin/pois", json=payload).status_code == 409
    assert (
        client.post("/api/v1/admin/ai/wikipedia", json={"url": URL}).json()["existing_poi"]["id"] == poi["id"]
    )
    poi = action(client, poi, "submit").json()
    login(client, "admin")
    poi = action(client, poi, "approve").json()
    assert action(client, poi, "publish").status_code == 200
    public = client.get(f"/api/v1/pois/{poi['id']}").json()
    assert public["source"] == payload["source"]
    assert public["translations"]["fr"]["text"]


def test_unknown_coordinates_and_image_stay_missing_and_bad_address_is_replaced_from_source(env, upstream):
    client, _, _ = env
    login(client)
    upstream.update(coordinates=False, image=False, bad_address=True)
    preview = client.post("/api/v1/admin/ai/wikipedia", json={"url": URL}).json()
    payload = preview["draft"]
    assert payload["latitude"] is None and payload["longitude"] is None
    assert payload["source"]["image_url"] is None
    assert payload["address"] == "4 Phạm Ngọc Thạch"
    assert set(preview["missing_fields"]) == {"latitude", "longitude", "image"}
    created = client.post("/api/v1/admin/pois", json=payload)
    assert created.status_code == 201
    assert created.json()["latitude"] is None
    assert client.post("/api/v1/admin/pois", json={**payload, "latitude": 10.7}).status_code == 422


@pytest.mark.parametrize("failure", ["bad_json", "truncated"])
def test_bad_ai_response_never_creates_a_poi(env, upstream, failure):
    client, factory, _ = env
    login(client)
    upstream[failure] = True
    assert client.post("/api/v1/admin/ai/wikipedia", json={"url": URL}).status_code == 502
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Poi)) == 0


def test_disabled_or_unknown_languages_are_rejected_before_fetch(env, upstream):
    client, _, _ = env
    login(client)
    assert (
        client.post("/api/v1/admin/ai/wikipedia", json={"url": URL, "language_codes": ["xx"]}).status_code
        == 422
    )
    assert not upstream["calls"]


def test_redirects_cannot_escape_wikimedia():
    with pytest.raises(ValueError):
        wikipedia.WikimediaRedirects().redirect_request(None, None, 302, "", {}, "http://127.0.0.1/private")
    with pytest.raises(ValueError):
        wikipedia.NoRedirects().redirect_request(None, None, 302, "", {}, "https://vi.wikipedia.org/")
