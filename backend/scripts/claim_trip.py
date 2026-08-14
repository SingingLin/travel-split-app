"""One-off CLI tool: manually grant a user "owner" access to an existing
trip that predates the User/TripAccess auth system (see backend/app/auth.py,
backend/app/models.py).

Why this is needed: adding TripAccess-based permission checks means
GET /api/trips now only returns trips the calling user has a TripAccess row
for. The demo trip seeded before this round ("東京五日自由行", see
scripts/seed_demo_data.py) has zero TripAccess rows, so after this round
ships it becomes invisible to *everyone* until someone explicitly grants
themselves access to it — that's what this script does, by hand, for
whichever trip_id + email you tell it.

Typical use (per this round's rollout plan): once a real user has logged in
at least once via Google (so their User row exists — get_current_user
upserts it on first authenticated request), run this once to hand them
"東京五日自由行" (or any other pre-auth trip) as its owner.

Usage (from backend/, with the venv active):
    .venv/bin/python scripts/claim_trip.py <email> <trip_id>

Example:
    .venv/bin/python scripts/claim_trip.py alice@example.com 1

Idempotent: re-running with the same (email, trip_id) is a no-op — it prints
the existing role and makes no change, rather than erroring or creating a
duplicate row (trip_access has a UniqueConstraint(trip_id, user_id) that
would reject a duplicate insert anyway).
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app import models  # noqa: E402
from app.database import SessionLocal  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__)
        print("Usage: python scripts/claim_trip.py <email> <trip_id>")
        sys.exit(1)

    email = sys.argv[1].strip()
    try:
        trip_id = int(sys.argv[2])
    except ValueError:
        print(f"trip_id must be an integer, got {sys.argv[2]!r}")
        sys.exit(1)

    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user:
            print(
                f"No user found with email {email!r}. That account must log in at "
                "least once first (get_current_user creates the User row automatically "
                "on their first authenticated API request) before this script can grant "
                "it trip access."
            )
            sys.exit(1)

        trip = db.get(models.Trip, trip_id)
        if not trip:
            print(f"No trip found with id {trip_id}.")
            sys.exit(1)

        existing = (
            db.query(models.TripAccess)
            .filter(models.TripAccess.trip_id == trip_id, models.TripAccess.user_id == user.id)
            .first()
        )
        if existing:
            print(
                f"{email} already has {existing.role!r} access to trip {trip_id} "
                f"({trip.name!r}) — no change made."
            )
            return

        access = models.TripAccess(trip_id=trip_id, user_id=user.id, role="owner")
        db.add(access)
        db.commit()
        print(f"Granted owner access: {email} -> trip {trip_id} ({trip.name!r}).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
