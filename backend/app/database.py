"""SQLite database setup.

The DB file lives at backend/travel_split.db by default (override with the
DATABASE_URL env var, e.g. for tests we use an in-memory sqlite DB).
Tables are created automatically on startup (see main.py) — no separate
migration step is needed for this local-file-DB project.
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "travel_split.db")
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)

# Enforce FK constraints in sqlite (off by default).
from sqlalchemy import event


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    if DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
