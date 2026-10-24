"""Private Supabase objects behind the existing authorized /media/{id} API.

Media.filename is an opaque locator: legacy local basename, or
supabase://bucket/object-key (at most the existing 120 characters).
No signed URL or credential is persisted in application data.
"""
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import HTTPException

MAX_IMAGE_BYTES = 10 * 1024 * 1024
PREFIX = "supabase://"


def driver():
    value = os.getenv("MEDIA_STORAGE_DRIVER", "supabase" if os.getenv("APP_ENV") == "production" else "local")
    if value not in {"local", "supabase"}:
        raise HTTPException(503, "media_storage_not_configured")
    return value


def object_reference(bucket, key):
    if (not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,62}", bucket)
            or not key or any(part in {"", ".", ".."} for part in key.split("/"))
            or any(ord(c) < 32 or c == "\\" for c in key)):
        raise HTTPException(422, "invalid_media_path")
    value = PREFIX + bucket + "/" + key
    if len(value) > 120:
        raise HTTPException(422, "invalid_media_path")
    return value


def parse_reference(value):
    if not value.startswith(PREFIX):
        return None
    bucket, separator, key = value[len(PREFIX):].partition("/")
    if not separator or object_reference(bucket, key) != value:
        raise HTTPException(422, "invalid_media_path")
    return bucket, key


def local_path(root, filename):
    if not filename or Path(filename).name != filename or filename in {".", ".."} or "\\" in filename:
        raise HTTPException(404, "media_file_not_found")
    return root / filename


class NoStorageRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise HTTPException(503, "media_storage_unavailable")


class SupabaseStorage:
    def __init__(self):
        origin = os.getenv("SUPABASE_URL", "").rstrip("/")
        try:
            parsed = urlsplit(origin)
            port = parsed.port
        except ValueError:
            raise HTTPException(503, "media_storage_not_configured") from None
        key = os.getenv("SUPABASE_SECRET_KEY", "") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        if (parsed.scheme != "https" or not re.fullmatch(r"[a-z0-9-]+\.supabase\.co", parsed.hostname or "")
                or parsed.username or parsed.password or port or parsed.path or parsed.query or parsed.fragment
                or len(key) < 24 or any(ord(c) < 33 for c in key)):
            raise HTTPException(503, "media_storage_not_configured")
        self.origin, self.key = origin, key

    def request(self, method, path, *, data=None, mime=None, image=False):
        headers = {"apikey": self.key, "User-Agent": "Quan1TourismStorage/1.0"}
        # Secret API keys are not JWTs. Legacy service_role JWTs use both headers.
        if not self.key.startswith("sb_secret_"):
            headers["Authorization"] = "Bearer " + self.key
        if mime:
            headers["Content-Type"] = mime
        if method == "POST":
            headers["x-upsert"] = "false"
        request = Request(self.origin + "/storage/v1/object/" + path,
                          method=method, headers=headers, data=data)
        try:
            with build_opener(NoStorageRedirects()).open(request, timeout=30) as response:
                raw = response.read((MAX_IMAGE_BYTES if image else 64 * 1024) + 1)
                if len(raw) > (MAX_IMAGE_BYTES if image else 64 * 1024):
                    raise HTTPException(503, "media_storage_unavailable")
                return raw
        except HTTPError as error:
            missing = error.code == 404
            if error.code == 400:
                try:
                    missing = str(json.loads(error.read(4096)).get("statusCode")) == "404"
                except (ValueError, TypeError, AttributeError):
                    pass
            raise HTTPException(404 if method == "GET" and missing else 503,
                                "media_file_not_found" if method == "GET" and missing else
                                "media_storage_unavailable") from None
        except (URLError, OSError, ValueError):
            raise HTTPException(503, "media_storage_unavailable") from None

    def upload(self, bucket, key, raw, mime):
        reference = object_reference(bucket, key)
        self.request("POST", quote(bucket, safe="") + "/" + quote(key, safe="/"), data=raw, mime=mime)
        return reference

    def download(self, bucket, key):
        object_reference(bucket, key)
        return self.request("GET", "authenticated/" + quote(bucket, safe="") + "/" + quote(key, safe="/"), image=True)

    def delete(self, bucket, key):
        object_reference(bucket, key)
        self.request("DELETE", quote(bucket, safe=""),
                     data=json.dumps({"prefixes": [key]}).encode(), mime="application/json")


def store_image(root, filename, raw, mime):
    if driver() == "supabase":
        bucket = os.getenv("SUPABASE_STORAGE_BUCKET", "place-images")
        return SupabaseStorage().upload(bucket, filename, raw, mime)
    path = local_path(root, filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as destination:
        destination.write(raw)
    return filename


def remove_new_image(root, reference):
    remote = parse_reference(reference)
    if remote:
        SupabaseStorage().delete(*remote)
    else:
        local_path(root, reference).unlink(missing_ok=True)


def read_remote_image(reference, size, checksum):
    remote = parse_reference(reference)
    if not remote:
        raise HTTPException(404, "media_file_not_found")
    raw = SupabaseStorage().download(*remote)
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != checksum:
        raise HTTPException(503, "media_integrity_failed")
    return raw
