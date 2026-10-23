"""Create the first administrator; never seed public demo credentials in production."""

import argparse
import getpass
import json
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "backend"))

from app.auth import passwords  # noqa: E402
from app.config import RUNTIME  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import User  # noqa: E402
from app.schemas import Register  # noqa: E402
from sqlalchemy import select  # noqa: E402


def create(email, name, generated=False):
    password = secrets.token_urlsafe(24) if generated else getpass.getpass("Administrator password: ")
    data = Register(name=name, email=email, password=password)
    credentials = RUNTIME / "initial-admin.json"
    if generated and credentials.exists():
        raise RuntimeError("Local credential file already exists; it will not be overwritten.")
    with SessionLocal() as db:
        if db.scalar(select(User.id).where(User.role == "admin")):
            raise RuntimeError("An administrator already exists; no account was created or reset.")
        if db.scalar(select(User.id).where(User.email == data.email)):
            raise RuntimeError("This email already exists; no account was modified.")
        user = User(email=data.email, name=data.name, role="admin", password_hash=passwords.hash(password))
        db.add(user)
        # Write before commit so a filesystem failure cannot create an inaccessible account.
        if generated:
            RUNTIME.mkdir(exist_ok=True)
            with credentials.open("x", encoding="utf-8") as file:
                json.dump({"email": data.email, "password": password}, file)
        try:
            db.commit()
        except Exception:
            if generated:
                credentials.unlink(missing_ok=True)
            raise
    print("Administrator created." + (" Credentials saved to .runtime/initial-admin.json." if generated else ""))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="Quản trị viên")
    parser.add_argument("--generate-password", action="store_true")
    args = parser.parse_args()
    try:
        create(args.email, args.name, args.generate_password)
    except Exception as exc:
        print(str(exc) if type(exc) is RuntimeError else "Administrator creation failed; check the database and input.")
        sys.exit(1)
