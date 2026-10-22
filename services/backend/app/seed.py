"""Explicitly opt-in, repeatable LOCAL demo seed. Does not overwrite existing data."""

import argparse
from datetime import timedelta

from sqlalchemy import select

from .auth import passwords
from .db import SessionLocal
from .models import Audit, Category, Poi, User, now

DEMO_PASSWORD = "Quan1Demo!2026"  # Public local demo credential, not a production secret.
PLACES = [
    ("Dinh Độc Lập", "Independence Palace", "135 Nam Kỳ Khởi Nghĩa", "heritage", 10.7770, 106.6953),
    ("Nhà thờ Đức Bà", "Notre-Dame Cathedral", "01 Công xã Paris", "heritage", 10.7798, 106.6990),
    ("Bưu điện Trung tâm", "Central Post Office", "02 Công xã Paris", "architecture", 10.7799, 106.7000),
    ("Chợ Bến Thành", "Ben Thanh Market", "Đường Lê Lợi", "culture", 10.7725, 106.6980),
    ("Nhà hát Thành phố", "City Opera House", "07 Công trường Lam Sơn", "architecture", 10.7765, 106.7032),
    ("Phố đi bộ Nguyễn Huệ", "Nguyen Hue Walking Street", "Đường Nguyễn Huệ", "culture", 10.7740, 106.7030),
    ("Bảo tàng Mỹ thuật", "Fine Arts Museum", "97A Phó Đức Chính", "culture", 10.7699, 106.6998),
    ("Công viên Tao Đàn", "Tao Dan Park", "55C Nguyễn Thị Minh Khai", "nature", 10.7763, 106.6893),
    (
        "Đường sách Nguyễn Văn Bình",
        "Nguyen Van Binh Book Street",
        "Đường Nguyễn Văn Bình",
        "culture",
        10.7803,
        106.7000,
    ),
    (
        "Thảo Cầm Viên",
        "Saigon Zoo and Botanical Gardens",
        "02 Nguyễn Bỉnh Khiêm",
        "nature",
        10.7874,
        106.7053,
    ),
    ("Bến Bạch Đằng", "Bach Dang Wharf", "Đường Tôn Đức Thắng", "nature", 10.7745, 106.7070),
    ("Bảo tàng Lịch sử", "History Museum", "02 Nguyễn Bỉnh Khiêm", "heritage", 10.7890, 106.7047),
]


def seed():
    with SessionLocal() as db:
        for role, name in (("admin", "Minh Anh"), ("editor", "Người biên tập"), ("reviewer", "Người duyệt")):
            if not db.scalar(select(User).where(User.email == f"{role}@quan1.local")):
                db.add(
                    User(
                        email=f"{role}@quan1.local",
                        name=name,
                        role=role,
                        password_hash=passwords.hash(DEMO_PASSWORD),
                    )
                )
        for key, name, color in (
            ("heritage", "Di tích lịch sử", "orange"),
            ("architecture", "Kiến trúc", "purple"),
            ("culture", "Văn hóa & đời sống", "blue"),
            ("nature", "Không gian xanh", "green"),
        ):
            if not db.get(Category, key):
                db.add(Category(id=key, name=name, color=color))
        db.flush()
        for i, (name, en, address, category, lat, lng) in enumerate(PLACES):
            poi_id = f"demo-{i + 1:02d}"
            if db.get(Poi, poi_id):
                continue
            poi = Poi(
                id=poi_id,
                name=name,
                address=f"{address}, Quận 1, TP. Hồ Chí Minh",
                category_id=category,
                latitude=lat,
                longitude=lng,
                cover=i % 4,
                is_demo=True,
                updated_at=now() - timedelta(hours=i * 3),
                translations={
                    "vi": {
                        "title": name,
                        "text": f"Chào mừng bạn đến với {name}. Hãy dành một chút thời gian quan sát không gian xung quanh và cảm nhận nhịp sống của Sài Gòn. Đây là bài thuyết minh mẫu để biên tập viên thay bằng nội dung đã được xác minh.",
                        "audio_id": None,
                    },
                    "en": {
                        "title": en,
                        "text": f"Welcome to {en}. Take a moment to look around and enjoy the atmosphere of Saigon. This is sample narration for editors to replace with verified content."
                        if i < 8
                        else "",
                        "audio_id": None,
                    },
                },
            )
            db.add(poi)
            db.flush()
            db.add(
                Audit(
                    poi_id=poi.id,
                    actor="Dữ liệu mẫu",
                    action="create",
                    detail="Nội dung minh họa, cần xác minh trước khi xuất bản.",
                )
            )
        db.commit()
    print("Demo seed ready: 12 draft places. Existing data preserved. See README for local demo accounts.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--demo", action="store_true", help="Create public LOCAL demo accounts and draft content"
    )
    if not parser.parse_args().demo:
        parser.error("Use --demo to explicitly opt in. Never run this seed in production.")
    seed()
