"""Website visits use the same anonymous session as place engagement."""

from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import case, delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session as DbSession

from .auth import digest, optional_user, require
from .db import get_db
from .models import Poi, SitePresenceSession, SiteVisitDaily, SiteVisitSession, User, now

router = APIRouter(prefix="/api/v1", tags=["statistics"])
SITE_TIMEZONE = timezone(timedelta(hours=7))
PRESENCE_WINDOW_SECONDS = 90


@router.post("/events/presence", status_code=204)
def record_presence(request: Request, db: DbSession = Depends(get_db)):
    session_hash = digest(request.state.visit_session)
    user = optional_user(request, db)
    if user and user.role != "visitor":
        db.execute(delete(SitePresenceSession).where(SitePresenceSession.session_hash == session_hash))
        db.commit()
        return
    seen_at = now()
    insert = sqlite_insert if db.bind.dialect.name == "sqlite" else pg_insert
    heartbeat = insert(SitePresenceSession).values(session_hash=session_hash, last_seen_at=seen_at)
    db.execute(heartbeat.on_conflict_do_update(
        index_elements=["session_hash"], set_={"last_seen_at": seen_at},
        where=SitePresenceSession.last_seen_at < seen_at,
    ))
    # Indexed expiry bounds storage; heartbeats never modify visit/view/listen totals.
    db.execute(delete(SitePresenceSession).where(SitePresenceSession.last_seen_at < seen_at - timedelta(days=1)))
    db.commit()


@router.post("/events/visit", status_code=204)
def record_visit(request: Request, db: DbSession = Depends(get_db)):
    user = optional_user(request, db)
    if user and user.role != "visitor":
        return
    recorded_at = now()
    insert = sqlite_insert if db.bind.dialect.name == "sqlite" else pg_insert
    claim = insert(SiteVisitSession).values(
        session_hash=digest(request.state.visit_session), recorded_at=recorded_at,
    )
    accepted = db.execute(claim.on_conflict_do_update(
        index_elements=["session_hash"],
        set_={"recorded_at": recorded_at},
        where=SiteVisitSession.recorded_at <= recorded_at - timedelta(minutes=30),
    ).returning(SiteVisitSession.session_hash)).scalar_one_or_none()
    if accepted:
        daily = insert(SiteVisitDaily).values(day=recorded_at.astimezone(SITE_TIMEZONE).date(), visit_count=1)
        db.execute(daily.on_conflict_do_update(
            index_elements=["day"], set_={"visit_count": SiteVisitDaily.visit_count + 1},
        ))
    # Claim and count commit together, including across concurrent workers.
    db.commit()


@router.get("/admin/statistics")
def statistics(db: DbSession = Depends(get_db), user: User = Depends(require("admin"))):
    measured_at = now()
    today = measured_at.astimezone(SITE_TIMEZONE).date()
    active_visitors = db.scalar(select(func.count()).select_from(SitePresenceSession).where(
        SitePresenceSession.last_seen_at > measured_at - timedelta(seconds=PRESENCE_WINDOW_SECONDS),
        SitePresenceSession.last_seen_at <= measured_at,
    ))
    week_start = today - timedelta(days=6)
    month_start = today - timedelta(days=29)
    total, daily, weekly, monthly = db.execute(select(
        func.coalesce(func.sum(SiteVisitDaily.visit_count), 0),
        func.coalesce(func.sum(case((SiteVisitDaily.day == today, SiteVisitDaily.visit_count), else_=0)), 0),
        func.coalesce(func.sum(case((SiteVisitDaily.day >= week_start, SiteVisitDaily.visit_count), else_=0)), 0),
        func.coalesce(func.sum(case((SiteVisitDaily.day >= month_start, SiteVisitDaily.visit_count), else_=0)), 0),
    ).where(SiteVisitDaily.day <= today)).one()
    history = dict(db.execute(select(SiteVisitDaily.day, SiteVisitDaily.visit_count).where(
        SiteVisitDaily.day >= month_start, SiteVisitDaily.day <= today,
    )).all())
    views, listens = db.execute(select(
        func.coalesce(func.sum(Poi.view_count), 0), func.coalesce(func.sum(Poi.listen_count), 0),
    )).one()
    return {
        "active_visitors": active_visitors,
        "active_window_seconds": PRESENCE_WINDOW_SECONDS,
        "total_visits": total,
        "today_visits": daily,
        "last_7_days_visits": weekly,
        "last_30_days_visits": monthly,
        "total_views": views,
        "total_listens": listens,
        "timezone": "Asia/Ho_Chi_Minh",
        "daily": [
            {"date": (day := month_start + timedelta(days=offset)).isoformat(), "visits": history.get(day, 0)}
            for offset in range(30)
        ],
    }
