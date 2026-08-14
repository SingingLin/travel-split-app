import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import (
    BASE_DIR,
    Base,
    backfill_role_member_to_editor,
    engine,
    ensure_columns,
    ensure_unique_index,
)
from app.routers import auth as auth_router
from app.routers import categories, currencies, expenses, members, payment_methods, settlement, trips, uploads

# Local single-file SQLite DB: create tables on startup if they don't exist yet.
# This is a local desktop-style tool, so a lightweight "create if missing" is
# sufficient — no Alembic migration chain.
Base.metadata.create_all(bind=engine)

# create_all() above only creates *missing tables* — it never adds columns to
# a table that already exists, so any column added to models.py after the
# DB file was first created needs an explicit backfill here (idempotent, see
# ensure_columns' docstring in database.py). Keep this list append-only
# across future rounds; each entry is skipped automatically once it's
# already present.
ensure_columns(
    "expenses",
    ["foreign_fee REAL", "type TEXT NOT NULL DEFAULT 'expense'", "image_url TEXT"],
)
ensure_columns(
    "trips",
    [
        "initial_budget REAL",
        "initial_exchange_from_currency TEXT",
        "initial_exchange_from_amount REAL",
        "initial_exchange_to_currency TEXT",
        "initial_exchange_to_amount REAL",
        "initial_exchange_rate REAL",
        "invite_code TEXT",
    ],
)
# invite_code needs to be unique but SQLite's ADD COLUMN above can't attach a
# UNIQUE constraint inline (see ensure_columns/ensure_unique_index
# docstrings) — added as a separate index right after the column itself.
ensure_unique_index("trips", "ix_trips_invite_code", "invite_code")

# users.is_guest (see models.User docstring / routers/auth.py) — backfills
# every pre-existing User row (all real Google logins so far) to
# is_guest=False via this column's SQLite-level DEFAULT.
ensure_columns("users", ["is_guest BOOLEAN NOT NULL DEFAULT 0"])

# users.recovery_code — RETIRED (see models.User docstring): used to back
# the guest "找回代碼" recovery flow, removed by this round's guest
# simplification (a guest identity no longer has any recoverable "account").
# Column + its unique index are kept in place (dead, never written to for a
# new row) rather than migrated away, per this project's "舊欄位保留閒置"
# convention.
ensure_columns("users", ["recovery_code TEXT"])
ensure_unique_index("users", "ix_users_recovery_code", "recovery_code")

# members.user_id (see models.Member docstring) — optional link from a
# split-accounting Member to the User/login identity it corresponds to.
# Every pre-existing Member row backfills to NULL (nullable, no default),
# which is exactly correct: they predate this feature, so there's nothing to
# link them to automatically. Must run after the "users" table itself is
# guaranteed to exist (create_all() above already creates it before any of
# these ensure_columns calls run) since this column REFERENCES users(id).
ensure_columns("members", ["user_id INTEGER REFERENCES users(id) ON DELETE SET NULL"])

# members.initial_exchange_* (see models.Member docstring) — per-person
# "初始換匯" record, moved here from being trip-wide only (Trip.
# initial_exchange_* above stays in place, unused, per this project's
# no-migration-tooling policy). Every pre-existing Member row backfills to
# NULL for all five, which is correct: nobody had per-person exchange data
# before this feature existed.
ensure_columns(
    "members",
    [
        "initial_exchange_from_currency TEXT",
        "initial_exchange_from_amount REAL",
        "initial_exchange_to_currency TEXT",
        "initial_exchange_to_amount REAL",
        "initial_exchange_rate REAL",
    ],
)

# One-time DATA content update (not a schema change — trip_access.role's
# column shape is unchanged) for the "擁有者／可編輯／唯讀" role rename: every
# pre-existing role='member' row becomes role='editor', same permissions,
# just a clearer name (see database.py backfill_role_member_to_editor's
# docstring and models.TripAccess's docstring for the full rationale).
# Idempotent — logs how many rows it actually touched purely for visibility;
# 0 on every startup after the first is expected and fine.
_migrated_member_roles = backfill_role_member_to_editor()
if _migrated_member_roles:
    print(f"[startup] migrated {_migrated_member_roles} trip_access row(s) from role='member' to role='editor'")

# backend/uploads/ holds user-uploaded expense receipt images (see
# routers/uploads.py) — not committed to git (see backend/.gitignore),
# created on first run since a fresh checkout won't have it yet.
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="TravelSplit API", version="1.0.0")

# CORS allow-list: configurable via the ALLOWED_ORIGINS env var (comma-
# separated origins, e.g. "https://travel-split.vercel.app,https://my.domain")
# so the deployed backend (Render) can allow the deployed frontend (Vercel)
# without a code change. Unset/empty ALLOWED_ORIGINS falls back to the
# original hardcoded local-dev origins — local development behavior is
# unchanged whether or not this env var exists.
_allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "").strip()
if _allowed_origins_env:
    ALLOWED_ORIGINS = [origin.strip() for origin in _allowed_origins_env.split(",") if origin.strip()]
else:
    ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(trips.router)
app.include_router(members.router)
app.include_router(currencies.router)
app.include_router(categories.router)
app.include_router(payment_methods.router)
app.include_router(expenses.router)
app.include_router(settlement.router)
app.include_router(uploads.router)

# Serves uploaded expense images back out at GET /uploads/<filename> — the
# relative URL the upload endpoint returns (see routers/uploads.py) is
# designed to be used directly as an <img src>.
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/api/health")
def health():
    return {"status": "ok"}
