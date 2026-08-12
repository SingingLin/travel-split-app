import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.database import BASE_DIR, Base, engine, ensure_columns
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
    ],
)

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
