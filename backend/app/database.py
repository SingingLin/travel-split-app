"""Database setup — SQLite by default, Postgres (e.g. Neon) opt-in.

Local dev needs zero config: the DB file lives at backend/travel_split.db
and just works. To point at a cloud Postgres instead (e.g. for deploying
the backend, or for one-time data migration), set the DATABASE_URL env var
— either in the real environment or in a gitignored backend/.env file
(loaded below via python-dotenv) — to a full SQLAlchemy URL such as
"postgresql://user:pass@host/dbname?sslmode=require". Nothing else in the
app needs to know which backend is active; ensure_columns() below branches
on engine.dialect.name for the one place SQLite/Postgres DDL differs.

Tables are created automatically on startup (see main.py) — no separate
migration step is needed for this local-file-DB project.
"""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Load backend/.env (if present) *before* reading DATABASE_URL below, so a
# gitignored .env file is enough to opt local dev into Postgres without
# ever hardcoding a connection string anywhere tracked by git. Explicit
# path (rather than load_dotenv()'s default upward directory search) keeps
# this from ever picking up an unrelated .env from some parent directory.
# load_dotenv()'s default override=False means a DATABASE_URL already set
# in the real environment (e.g. the test suite pins
# DATABASE_URL=sqlite:///:memory: before importing this module) always
# wins over whatever is in the file.
load_dotenv(os.path.join(BASE_DIR, ".env"))

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
    below are designed around. Postgres's `ADD COLUMN IF NOT EXISTS` is more
    lenient but this function is written to the SQLite subset throughout so
    the same column_defs work unchanged on both dialects.

    Branches on `engine.dialect.name` since the two DBs need different
    "does this column already exist" checks (SQLite has no
    `information_schema`; `PRAGMA table_info` is SQLite-only syntax) — the
    SQLite path is unchanged from before this function supported Postgres.
    In practice this rarely matters for a brand-new Postgres database:
    `Base.metadata.create_all()` (see main.py) creates every table with its
    *current* full set of model columns already included, so there are no
    "existing table missing a new column" gaps for this function to fill —
    but it must still not raise if it ever does run against Postgres.
    """
    with engine.begin() as conn:
        if engine.dialect.name == "sqlite":
            existing_cols = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table_name})"))
            }
            for col_def in column_defs:
                col_name = col_def.split()[0]
                if col_name in existing_cols:
                    continue
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_def}"))
        else:
            # Postgres (and any other dialect supporting the same syntax):
            # ADD COLUMN IF NOT EXISTS folds the existence check and the add
            # into one statement, so no separate information_schema query
            # is needed here.
            for col_def in column_defs:
                conn.execute(
                    text(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {col_def}")
                )
