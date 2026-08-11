"""Regression coverage for POST/PUT /api/trips/{id}/expenses rate handling.

Added after a real production bug (2026-08): the frontend's "可編輯匯率"
field, on switching the expense's currency, briefly computed the new
rate_snapshot as a ratio between two *different* currencies in the trip
(e.g. new_currency.rate_to_base / previously_selected_currency.rate_to_base)
instead of just the newly-selected currency's own rate_to_base — corrupting
saved data with rate_snapshot values that were neither the currency's real
rate nor anything a user would plausibly type by hand.

These tests exercise the actual bug's symptom from the backend side: a
trip with multiple non-base currencies, asserting that creating/updating an
expense in currency A (with A's own rate_to_base passed as rate_override,
exactly like the fixed frontend now always sends) never gets contaminated
by any *other* currency B's rate_to_base — each currency's expenses must
resolve to their own rate, independent of the others', and switching
currencies on an update must land on the new currency's own rate, not some
combination of old/new.
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import StaticPool, create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app

# Isolated in-memory DB per test module, shared across connections via
# StaticPool (plain "sqlite:///:memory:" would give every new connection its
# own empty DB, which breaks under TestClient's threaded requests).
engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db

client = TestClient(app)


@pytest.fixture()
def trip_setup():
    """A trip with three currencies (base TWD + JPY + USD, same shape as the
    real trip_id=2 the production bug was found on) plus one member/category/
    payment method, all created through the real API so this exercises the
    same code paths production traffic does."""
    trip = client.post(
        "/api/trips",
        json={"name": "Rate Regression Trip", "base_currency_code": "TWD"},
    ).json()
    trip_id = trip["id"]
    base_currency_id = next(c["id"] for c in trip["currencies"] if c["is_base"])

    jpy = client.post(
        f"/api/trips/{trip_id}/currencies",
        json={"code": "JPY", "name": "日圓", "rate_to_base": 0.2033693},
    ).json()
    usd = client.post(
        f"/api/trips/{trip_id}/currencies",
        json={"code": "USD", "name": "美元", "rate_to_base": 32.23207091},
    ).json()
    member = client.post(f"/api/trips/{trip_id}/members", json={"name": "Alice"}).json()

    return {
        "trip_id": trip_id,
        "base_currency_id": base_currency_id,
        "jpy": jpy,
        "usd": usd,
        "member": member,
    }


def _create_expense(trip_id, member_id, currency_id, amount, rate_override, foreign_fee=None):
    return client.post(
        f"/api/trips/{trip_id}/expenses",
        json={
            "date": "2026-08-11",
            "name": "test",
            "amount": amount,
            "foreign_fee": foreign_fee,
            "currency_id": currency_id,
            "rate_override": rate_override,
            "payer_id": member_id,
            "needs_split": False,
            "shares": [],
            "type": "expense",
        },
    )


def test_create_expense_in_each_currency_uses_only_that_currencys_own_rate(trip_setup):
    """The core regression: creating one expense per currency (each sending
    that currency's own rate_to_base as rate_override, exactly like the
    frontend's currency-<select> onChange does) must never cross-contaminate
    — none of the three should end up with another currency's rate, or a
    ratio between two currencies' rates (the exact shape of the real bug)."""
    trip_id = trip_setup["trip_id"]
    member_id = trip_setup["member"]["id"]
    base_id = trip_setup["base_currency_id"]
    jpy, usd = trip_setup["jpy"], trip_setup["usd"]

    base_expense = _create_expense(trip_id, member_id, base_id, 123.0, 1.0).json()
    jpy_expense = _create_expense(trip_id, member_id, jpy["id"], 222.0, jpy["rate_to_base"]).json()
    usd_expense = _create_expense(trip_id, member_id, usd["id"], 50.0, usd["rate_to_base"]).json()

    assert base_expense["rate_snapshot"] == 1.0
    assert base_expense["base_amount"] == 123.0

    assert jpy_expense["rate_snapshot"] == pytest.approx(0.2033693)
    assert jpy_expense["base_amount"] == pytest.approx(round(222.0 * 0.2033693, 2))

    assert usd_expense["rate_snapshot"] == pytest.approx(32.23207091)
    assert usd_expense["base_amount"] == pytest.approx(round(50.0 * 32.23207091, 2))

    # The exact corruption pattern seen in production: a reciprocal or
    # cross-ratio of two OTHER currencies' rates. Guard against ever landing
    # there again.
    bad_ratios = [
        1.0 / jpy["rate_to_base"],
        jpy["rate_to_base"] / usd["rate_to_base"],
        usd["rate_to_base"] / jpy["rate_to_base"],
    ]
    for exp in (base_expense, jpy_expense, usd_expense):
        assert all(exp["rate_snapshot"] != pytest.approx(bad) for bad in bad_ratios)


def test_create_expense_with_foreign_fee_includes_fee_in_base_amount(trip_setup):
    """Mirrors the real corrupted record (JPY expense with a 海外手續費) —
    base_amount must be computed from (amount + foreign_fee) * rate, using
    the currency's real rate, not a cross-currency ratio."""
    trip_id = trip_setup["trip_id"]
    member_id = trip_setup["member"]["id"]
    jpy = trip_setup["jpy"]

    resp = _create_expense(
        trip_id, member_id, jpy["id"], amount=222.0, rate_override=jpy["rate_to_base"], foreign_fee=0.07
    ).json()

    assert resp["rate_snapshot"] == pytest.approx(0.2033693)
    expected_base_amount = round((222.0 + 0.07) * 0.2033693, 2)
    assert resp["base_amount"] == pytest.approx(expected_base_amount)


def test_update_expense_switching_currency_uses_new_currencys_own_rate(trip_setup):
    """Reproduces the exact user action that triggered the production bug:
    an expense is created in one currency, then edited to a *different*
    currency, sending the new currency's own rate_to_base as rate_override
    (what the fixed ExpenseFormDialog's currency-<select> onChange now always
    does) — the resulting rate_snapshot must be exactly the new currency's
    rate, never a ratio involving the old one."""
    trip_id = trip_setup["trip_id"]
    member_id = trip_setup["member"]["id"]
    jpy, usd = trip_setup["jpy"], trip_setup["usd"]
    base_id = trip_setup["base_currency_id"]

    created = _create_expense(trip_id, member_id, jpy["id"], 222.0, jpy["rate_to_base"]).json()
    expense_id = created["id"]
    assert created["rate_snapshot"] == pytest.approx(0.2033693)

    # Switch JPY -> USD.
    updated = client.put(
        f"/api/trips/{trip_id}/expenses/{expense_id}",
        json={"currency_id": usd["id"], "rate_override": usd["rate_to_base"]},
    ).json()
    assert updated["currency_id"] == usd["id"]
    assert updated["rate_snapshot"] == pytest.approx(32.23207091)
    assert updated["rate_snapshot"] != pytest.approx(0.2033693 / 32.23207091)

    # Switch USD -> base (TWD), matching the CurrenciesSection/ExpenseForm
    # rule that a base currency's rate is always pinned to 1.0.
    updated2 = client.put(
        f"/api/trips/{trip_id}/expenses/{expense_id}",
        json={"currency_id": base_id, "rate_override": 1.0},
    ).json()
    assert updated2["rate_snapshot"] == 1.0
    assert updated2["base_amount"] == updated2["amount"]
    # Must not be the reciprocal-of-JPY-rate corruption seen in production.
    assert updated2["rate_snapshot"] != pytest.approx(1.0 / 0.2033693)


def test_update_expense_without_rate_override_recomputes_from_current_currency_rate(trip_setup):
    """No rate_override sent on update -> recompute rate_snapshot from
    currency.rate_to_base (documented behavior in routers/expenses.py), not
    "keep whatever override was used last time"."""
    trip_id = trip_setup["trip_id"]
    member_id = trip_setup["member"]["id"]
    jpy = trip_setup["jpy"]

    created = _create_expense(trip_id, member_id, jpy["id"], 222.0, rate_override=9.99).json()
    assert created["rate_snapshot"] == 9.99  # manual override honored at create time

    updated = client.put(
        f"/api/trips/{trip_id}/expenses/{created['id']}",
        json={"amount": 222.0},  # no rate_override field at all
    ).json()
    assert updated["rate_snapshot"] == pytest.approx(0.2033693)
