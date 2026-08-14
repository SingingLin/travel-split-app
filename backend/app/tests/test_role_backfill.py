"""Coverage for database.backfill_role_member_to_editor — the one-time DATA
content update (not a schema migration) that renames every pre-existing
trip_access.role='member' row to 'editor' with no permission change. See
models.TripAccess's docstring and main.py's startup call for the full
rationale."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from sqlalchemy import StaticPool, create_engine, text
from sqlalchemy.orm import sessionmaker

from app.database import Base


def _fresh_engine():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return engine


def test_backfill_migrates_existing_member_rows_to_editor_and_is_idempotent():
    import app.database as database_module

    engine = _fresh_engine()
    original_engine = database_module.engine
    database_module.engine = engine
    try:
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = SessionLocal()
        try:
            from app import models

            user1 = models.User(email="a@example.com", name="A")
            user2 = models.User(email="b@example.com", name="B")
            user3 = models.User(email="c@example.com", name="C")
            db.add_all([user1, user2, user3])
            db.flush()
            trip = models.Trip(name="T", base_currency_code="TWD")
            db.add(trip)
            db.flush()
            db.add(models.TripAccess(trip_id=trip.id, user_id=user1.id, role="owner"))
            db.add(models.TripAccess(trip_id=trip.id, user_id=user2.id, role="member"))
            db.add(models.TripAccess(trip_id=trip.id, user_id=user3.id, role="member"))
            db.commit()
        finally:
            db.close()

        migrated_count = database_module.backfill_role_member_to_editor()
        assert migrated_count == 2

        with engine.connect() as conn:
            roles = {row[0] for row in conn.execute(text("SELECT role FROM trip_access"))}
        assert roles == {"owner", "editor"}

        # Idempotent: nothing left to migrate on a second call.
        assert database_module.backfill_role_member_to_editor() == 0
    finally:
        database_module.engine = original_engine
