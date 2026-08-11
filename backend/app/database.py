"""SQLite database setup.

The DB file lives at backend/travel_split.db by default (override with the
DATABASE_URL env var, e.g. for tests we use an in-memory sqlite DB).
Tables are created automatically on startup (see main.py) — no separate
migration step is needed for this local-file-DB project.
"""
import os
from sqlalchemy import create_engine, text
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


def ensure_columns(table_name: str, column_defs: list[str]) -> None:
    """Idempotent lightweight "migration": add any columns in `column_defs`
    that don't already exist on `table_name`, leave existing ones untouched.

    This project has no Alembic (or similar) migration chain — `Base.metadata
    .create_all()` (see main.py) only creates *missing tables*, it never adds
    columns to a table that already exists. Since the local SQLite file
    persists real user data across app restarts, naively adding a column to a
    model in models.py would make every read/write against the existing file
    start failing (SQLAlchemy would generate SQL referencing a column SQLite
    doesn't have) instead of raising a clear migration error.

    Call this once per table, after `create_all()`, with the *full* list of
    "new" columns that table currently needs (each item is a raw column
    definition fragment as it should appear after `ADD COLUMN`, e.g.
    `"foreign_fee REAL"` or `"type TEXT NOT NULL DEFAULT 'expense'"`). Safe to
    call on every startup and to call again in a future round with more
    columns appended — each column is only added if `PRAGMA table_info`
    doesn't already report it, so re-running is always a no-op for columns
    that already exist. Existing rows get SQLite's column default (or NULL if
    the column is nullable with no default) for the new column; no existing
    data is read or rewritten.

    SQLite's `ALTER TABLE ... ADD COLUMN` only supports a small subset of
    column definitions (no non-constant defaults, no new UNIQUE/FK
    constraints) — stick to simple nullable columns or `NOT NULL DEFAULT
    <constant>` here, same restriction Expense.foreign_fee / Expense.type
    below are designed around.
    """
    with engine.begin() as conn:
        existing_cols = {
            row[1] for row in conn.execute(text(f"PRAGMA table_info({table_name})"))
        }
        for col_def in column_defs:
            col_name = col_def.split()[0]
            if col_name in existing_cols:
                continue
            conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_def}"))
