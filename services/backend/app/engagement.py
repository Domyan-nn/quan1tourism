"""One event per place, browser session and kind in a rolling 30 minute window."""

from datetime import timedelta

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .auth import digest, optional_user
from .models import Poi, PoiEngagement, now

ENGAGEMENT_COOKIE = "quan1_visit"


def record(db, request, poi_id, kind):
    user = optional_user(request, db)
    # Staff can preview or listen without changing visitor statistics.
    if user and user.role != "visitor":
        return
    recorded_at = now()
    insert = sqlite_insert if db.bind.dialect.name == "sqlite" else pg_insert
    statement = insert(PoiEngagement).values(
        session_hash=digest(request.state.visit_session), poi_id=poi_id,
        kind=kind, recorded_at=recorded_at,
    )
    accepted = db.execute(statement.on_conflict_do_update(
        index_elements=["session_hash", "poi_id", "kind"],
        set_={"recorded_at": recorded_at},
        where=PoiEngagement.recorded_at <= recorded_at - timedelta(minutes=30),
    ).returning(PoiEngagement.poi_id)).scalar_one_or_none()
    if accepted:
        counter = Poi.view_count if kind == "view" else Poi.listen_count
        db.execute(update(Poi).where(Poi.id == poi_id).values({counter: counter + 1}))
    # The deduplication claim and increment commit together; no read/modify/write race.
    db.commit()
