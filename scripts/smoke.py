"""Read-only smoke checks. Never logs bodies, cookies, credentials or content."""
import argparse
import json
import re
import sys
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener
from http.cookiejar import CookieJar


def smoke(origin, release, *, tiles=True, require_place=True, site=True, require_worker=False):
    parsed = urlsplit(origin)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("Smoke requires an origin without credentials or paths")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}):
        raise ValueError("Smoke requires HTTPS (loopback HTTP allowed)")
    origin = origin.rstrip("/")
    opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def get(path, status=200):
        try:
            result = opener.open(Request(origin + path, headers={"Cache-Control": "no-cache"}), timeout=30)
        except HTTPError as exc:
            result = exc
        assert result.status == status, f"Unexpected HTTP status for {path.split('?')[0]}"
        assert urlsplit(result.url).netloc == parsed.netloc, "Unexpected cross-origin redirect"
        data = result.read(5_000_001)
        assert len(data) <= 5_000_000, "Smoke response too large"
        return result.headers, data

    for path in (("/", "/admin/") if site else ()):
        _, html = get(path)
        assert b'<div id="root"' in html and b"/src/" not in html, "Expected compiled React HTML"
        for asset in re.findall(rb'(?:src|href)="([^"?#]+\.(?:js|css))"', html):
            asset = asset.decode()
            assert asset.startswith("/") and not asset.startswith("//")
            get(asset)
    for path in ("/api/v1/health/live", "/api/v1/health/ready"):
        assert json.loads(get(path)[1])["status"] == "ok"
    assert json.loads(get("/api/v1/version")[1])["release"] == release, "API serves another release"
    if site:
        release_headers, release_body = get("/release.json")
        assert json.loads(release_body)["release"] == release, "Frontend serves another release"
        if require_worker:
            assert release_headers.get("X-Release-SHA") == release, "Worker serves another release"
            assert "no-store" in release_headers.get("Cache-Control", "")
    headers, body = get("/api/v1/pois")
    assert "no-store" in headers.get("Cache-Control", "")
    assert "HttpOnly" in headers.get("Set-Cookie", ""), "Visitor cookie lost through proxy"
    if parsed.scheme == "https":
        assert "Secure" in headers.get("Set-Cookie", "")
    items = json.loads(body)["items"]

    def private(value):
        if isinstance(value, dict):
            assert not ({"view_count", "listen_count", "display_order"} & value.keys()), "Public statistics leak"
            for item in value.values():
                private(item)
        elif isinstance(value, list):
            for item in value:
                private(item)
    private(items)
    assert items or not require_place, "Provision a dedicated published staging fixture before smoke"
    if items:
        # This explicit read-only option is covered by backend regression tests.
        private(json.loads(get("/api/v1/pois/" + quote(items[0]["id"], safe="") + "?track_view=false")[1]))
    denied, _ = get("/api/v1/admin/pois", 401)
    assert "no-store" in denied.get("Cache-Control", "")
    get("/api/v1/does-not-exist", 404)
    if tiles:
        headers, image = get("/map-tiles/0/0/0.png")
        assert headers.get_content_type() == "image/png" and image.startswith(b"\x89PNG\r\n\x1a\n")
        get("/map-tiles/1/999/1.png", 404)
    print("Smoke passed: built routes/assets, release identity, public privacy, auth, cookies/cache" + (", tiles." if tiles else "."))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--no-tiles", action="store_true", help="Backend-only verification")
    parser.add_argument("--api-only", action="store_true", help="Render API origin before Cloudflare deployment")
    parser.add_argument("--worker", action="store_true", help="Also verify Worker release identity on Cloudflare")
    parser.add_argument("--allow-empty", action="store_true", help="Only for a clean disposable Docker database")
    args = parser.parse_args()
    try:
        smoke(args.origin, args.release, tiles=not args.no_tiles, require_place=not args.allow_empty,
              site=not args.api_only, require_worker=args.worker)
    except Exception:
        sys.exit("Smoke failed. Check deployment identity/routing/health in restricted logs; no response data emitted.")
