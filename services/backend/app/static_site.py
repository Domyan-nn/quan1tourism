"""Optional same-origin hosting for the combined production frontend build."""

from pathlib import Path

from fastapi import HTTPException
from fastapi.staticfiles import StaticFiles


def mount_site(app, root):
    root = Path(root)
    if not (root / "index.html").is_file() or not (root / "admin" / "index.html").is_file():
        raise RuntimeError("STATIC_ROOT must contain the visitor and admin production builds.")

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    def unknown_api(path: str):
        raise HTTPException(404, "Không tìm thấy API.")

    app.mount("/admin", StaticFiles(directory=root / "admin", html=True), name="admin-site")
    app.mount("/", StaticFiles(directory=root, html=True), name="visitor-site")
