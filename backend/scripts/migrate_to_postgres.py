"""One-time data migration: local SQLite (backend/travel_split.db) -> the
Postgres database configured via DATABASE_URL (normally backend/.env).

This is NOT part of normal app startup or normal local development — it's a
throwaway tool for the single "move existing data into Neon" cutover. Safe
to leave in the repo afterward (it refuses to duplicate data on a second
run, see below), but there's no reason to run it again once the one-time
copy is done.

What it does, in FK-safe order (parents before children):
    trips -> members, currencies, categories, payment_methods -> expenses
    -> expense_shares

For every row copied, the original SQLite `id` is preserved (so all
foreign keys still resolve correctly on the Postgres side). After all rows
are inserted, each table's Postgres identity/serial sequence is reset to
MAX(id) so future ORM-generated inserts on Postgres don't collide with the
migrated ids.

Safety / idempotency:
    - Refuses to run if the target already has any rows in `trips` (unless
      --force is passed), so re-running this script by accident does not
      create duplicate rows.
    - Refuses to run unless DATABASE_URL resolves to a postgresql:// URL —
      this script only ever WRITES to the Postgres target; the SQLite
      source is only ever read from, never modified.
    - Ends with a row-count comparison between source and target for every
      table, and exits non-zero if any table's counts don't match.

Usage (from backend/, with the venv active and DATABASE_URL pointing at
the Postgres target, e.g. via backend/.env):
    .venv/bin/python scripts/migrate_to_postgres.py
    .venv/bin/python scripts/migrate_to_postgres.py --force   # see above
"""
import argparse
import sqlite3
import sys
from datetime import date, datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import text  # noqa: E402

from app import models  # noqa: E402
from app.database import DATABASE_URL, Base, SessionLocal, engine  # noqa: E402

SQLITE_PATH = BACKEND_DIR / "travel_split.db"

# (sqlite table name, ORM model) in FK-safe insert order.
TABLES_IN_FK_ORDER = [
    ("trips", models.Trip),
    ("members", models.Member),
    ("currencies", models.Currency),
    ("categories", models.Category),
    ("payment_methods", models.PaymentMethod),
    ("expenses", models.Expense),
    ("expense_shares", models.ExpenseShare),
]

# Columns that come back from sqlite3 as plain strings but need to be real
# Python date/datetime objects before being handed to a Postgres DATE/
# TIMESTAMP column via SQLAlchemy.
DATE_FIELDS = {"trips": ["start_date", "end_date"], "expenses": ["date"]}
DATETIME_FIELDS = {"trips": ["created_at"], "expenses": ["created_at", "updated_at"]}


def _to_date(value):
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _to_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    s = str(value).strip().replace("T", " ")
    return datetime.fromisoformat(s)


def _row_to_kwargs(table_name: str, model, row: sqlite3.Row) -> dict:
    valid_cols = {c.name for c in model.__table__.columns}
    raw = dict(row)
    extra = set(raw) - valid_cols
    if extra:
        print(f"    (skipping columns not present on {model.__name__}: {sorted(extra)})")
    kwargs = {k: v for k, v in raw.items() if k in valid_cols}
    for field in DATE_FIELDS.get(table_name, []):
        if field in kwargs:
            kwargs[field] = _to_date(kwargs[field])
    for field in DATETIME_FIELDS.get(table_name, []):
        if field in kwargs:
            kwargs[field] = _to_datetime(kwargs[field])
    return kwargs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Run even if the target already has trips (will duplicate data unless the target was cleared first).",
    )
    args = parser.parse_args()

    if not DATABASE_URL.startswith("postgresql"):
        print(
            "Refusing to run: DATABASE_URL does not resolve to a Postgres URL "
            f"(got scheme '{DATABASE_URL.split(':', 1)[0]}'). Set DATABASE_URL "
            "(e.g. in backend/.env) to the Postgres target first.",
            file=sys.stderr,
        )
        return 1

    if not SQLITE_PATH.exists():
        print(f"Refusing to run: source SQLite file not found at {SQLITE_PATH}", file=sys.stderr)
        return 1

    print(f"Source: sqlite:///{SQLITE_PATH.name} (read-only)")
    print(f"Target: Postgres (dialect={engine.dialect.name}), per DATABASE_URL")

    # Mirrors main.py's startup behavior — ensures every table/column exists
    # on the target before we insert anything.
    Base.metadata.create_all(bind=engine)

    target_db = SessionLocal()
    try:
        existing_trips = target_db.query(models.Trip).count()
        if existing_trips and not args.force:
            print(
                f"Refusing to run: target already has {existing_trips} trip(s). "
                "Pass --force to proceed anyway (will duplicate rows unless the "
                "target was intentionally cleared first).",
                file=sys.stderr,
            )
            return 1

        src = sqlite3.connect(f"file:{SQLITE_PATH}?mode=ro", uri=True)
        src.row_factory = sqlite3.Row

        counts: dict[str, int] = {}
        for table_name, model in TABLES_IN_FK_ORDER:
            rows = src.execute(f"SELECT * FROM {table_name} ORDER BY id").fetchall()
            for row in rows:
                target_db.add(model(**_row_to_kwargs(table_name, model, row)))
            target_db.flush()
            counts[table_name] = len(rows)
            print(f"  {table_name}: inserted {len(rows)} row(s)")

        target_db.commit()
        src.close()

        # Reset each table's Postgres sequence past the migrated max id so
        # future app-generated inserts don't collide with these ids.
        with engine.begin() as conn:
            for table_name, _ in TABLES_IN_FK_ORDER:
                if counts[table_name] == 0:
                    continue
                conn.execute(
                    text(
                        f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), "
                        f"(SELECT MAX(id) FROM {table_name}), true)"
                    )
                )
        print("Sequences reset to MAX(id) for every non-empty table.")
    finally:
        target_db.close()

    # Verification: row counts must match between source and target.
    print("\nVerifying row counts (SQLite source vs Postgres target)...")
    src = sqlite3.connect(f"file:{SQLITE_PATH}?mode=ro", uri=True)
    all_ok = True
    verify_db = SessionLocal()
    try:
        for table_name, model in TABLES_IN_FK_ORDER:
            src_count = src.execute(f"SELECT COUNT(*) FROM {table_name}").fetchone()[0]
            tgt_count = verify_db.query(model).count()
            ok = src_count == tgt_count
            all_ok = all_ok and ok
            print(f"  {table_name}: sqlite={src_count} postgres={tgt_count} {'OK' if ok else 'MISMATCH'}")
    finally:
        verify_db.close()
        src.close()

    if not all_ok:
        print("\nRow count mismatch detected — see above.", file=sys.stderr)
        return 1

    print("\nAll row counts match.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
