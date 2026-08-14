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


def ensure_unique_index(table_name: str, index_name: str, column_name: str) -> None:
    """Idempotent creation of a UNIQUE index on a column that was added to an
    *existing* table after the table itself already existed (e.g.
    trips.invite_code — see ensure_columns above for why a plain model field
    alone isn't enough, and models.Trip's invite_code docstring for why it
    needs to be unique).

    SQLite's `ALTER TABLE ... ADD COLUMN` (used by ensure_columns) can't
    attach a UNIQUE constraint inline, so the column is added as plain
    nullable there first, then this creates the unique index as a separate
    DDL statement. `CREATE UNIQUE INDEX IF NOT EXISTS` is supported by both
    SQLite and Postgres with identical syntax, so — unlike ensure_columns —
    no dialect branch is needed here. Standard SQL NULL-is-distinct
    semantics mean a UNIQUE index permits any number of NULL rows, so this is
    safe to run even though every existing trip's invite_code starts out
    NULL (only set lazily, the first time a trip's owner calls
    POST /api/trips/{trip_id}/invite).
    """
    with engine.begin() as conn:
        conn.execute(
            text(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON {table_name} ({column_name})")
        )


def backfill_role_member_to_editor() -> int:
    """One-time DATA content update (not a schema migration — no column
    shape changes, so ensure_columns/ensure_unique_index above don't apply
    here) for the "擁有者／可編輯／唯讀" role rename: every existing
    trip_access row with the old `role='member'` value becomes `role=
    'editor'`, a pure rename with no change in actual permissions (a
    "member" could already edit everything an "editor" can — see
    app/auth.py require_edit_access / models.TripAccess's docstring for the
    full history). Called once at startup (see main.py); idempotent — once
    no row has role='member' left, every later call just updates 0 rows.
    Returns the number of rows changed, purely so main.py can log it.
    """
    with engine.begin() as conn:
        result = conn.execute(text("UPDATE trip_access SET role = 'editor' WHERE role = 'member'"))
        return result.rowcount
