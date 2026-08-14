"""Coverage for POST /api/trips/{trip_id}/members/{member_id}/merge-into/{target_member_id}
(see app/routers/trips.py merge_member) — the manual "collapse two Members
into one" tool that backstops join_trip's automatic exact-name-match (see
test_auth.py's test_join_trip_links_existing_unlinked_member_with_exact_matching_name_instead_of_duplicating).

Focus areas called out by the task spec as the easiest places to get wrong:
  - Reassigning expenses.payer_id and expense_shares.member_id off the
    deleted member and onto the target.
  - The (expense_id, member_id) UNIQUE-constraint collision when BOTH the
    source and target already have their own share on the same expense —
    must combine (sum amounts, AND-together is_settled) rather than crash
    or silently drop data.
  - The merge-direction rule: a member with a linked account can never be
    the one that gets deleted (would silently lose that account's split-
    participant link with no way back).
  - Owner-only enforcement.
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from fastapi.testclient import TestClient
from sqlalchemy import StaticPool, create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app

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


import pytest


@pytest.fixture(autouse=True)
def _use_this_modules_db():
    # Same save/restore pattern as test_auth.py — multiple test modules
    # each point get_db at their own isolated in-memory engine, and pytest
    # imports every module before running any test, so the override must be
    # (re)installed per-test rather than left as whichever module imported
    # last.
    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _override_get_db
    yield
    if previous is not None:
        app.dependency_overrides[get_db] = previous
    else:
        app.dependency_overrides.pop(get_db, None)


client = TestClient(app)


def _headers(email: str, name: str = "Test User") -> dict:
    from app import auth

    class _FakeUser:
        def __init__(self, email, name):
            self.id = 0
            self.email = email
            self.name = name

    token = auth.create_access_token(_FakeUser(email, name))
    return {"Authorization": f"Bearer {token}"}


def _make_trip(owner_headers, name="Merge Trip"):
    trip = client.post("/api/trips", json={"name": name, "base_currency_code": "TWD"}, headers=owner_headers).json()
    return trip


def _base_currency_id(trip):
    return next(c["id"] for c in trip["currencies"] if c["is_base"])


def _add_member(trip_id, owner_headers, name):
    return client.post(f"/api/trips/{trip_id}/members", json={"name": name}, headers=owner_headers).json()


def _make_expense(trip_id, owner_headers, currency_id, payer_id, name="Some Expense", amount=300.0, shares=None):
    payload = {
        "date": "2026-08-13",
        "name": name,
        "amount": amount,
        "currency_id": currency_id,
        "payer_id": payer_id,
        "needs_split": bool(shares),
        "shares": shares or [],
        "type": "expense",
    }
    resp = client.post(f"/api/trips/{trip_id}/expenses", json=payload, headers=owner_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------- happy path: payer_id + non-conflicting shares reassigned ----------

def test_merge_reassigns_payer_and_shares_then_deletes_source():
    owner_headers = _headers("merge-owner-1@example.com", "Merge Owner 1")
    trip = _make_trip(owner_headers)
    trip_id = trip["id"]
    cur_id = _base_currency_id(trip)

    a = _add_member(trip_id, owner_headers, "小明")  # unlinked source, will be deleted
    b = _add_member(trip_id, owner_headers, "小華")  # target, kept

    third = _add_member(trip_id, owner_headers, "第三人")
    expense = _make_expense(
        trip_id,
        owner_headers,
        cur_id,
        payer_id=a["id"],
        shares=[
            {"member_id": a["id"], "amount": 150.0, "is_settled": False},
            {"member_id": third["id"], "amount": 150.0, "is_settled": True},
        ],
    )

    resp = client.post(f"/api/trips/{trip_id}/members/{a['id']}/merge-into/{b['id']}", headers=owner_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == b["id"]

    detail = client.get(f"/api/trips/{trip_id}", headers=owner_headers).json()
    member_ids = {m["id"] for m in detail["members"]}
    assert a["id"] not in member_ids
    assert b["id"] in member_ids

    updated_expense = client.get(f"/api/trips/{trip_id}/expenses", headers=owner_headers).json()
    updated = next(e for e in updated_expense if e["id"] == expense["id"])
    assert updated["payer_id"] == b["id"]
    # b had no pre-existing share on this expense, so a's share just moved
    # onto b unchanged (no combining needed here — see the dedicated
    # conflicting-shares test below for that case).
    share_member_ids = [s["member_id"] for s in updated["shares"]]
    assert share_member_ids.count(b["id"]) == 1
    assert a["id"] not in share_member_ids
    b_share = next(s for s in updated["shares"] if s["member_id"] == b["id"])
    assert b_share["amount"] == pytest_approx(150.0)


# ---------- the tricky edge case: BOTH sides already have a share on the same expense ----------

def test_merge_combines_conflicting_shares_on_same_expense_instead_of_violating_unique_constraint():
    """This is the scenario called out explicitly by the task spec: member_id
    and target_member_id both already have their own ExpenseShare row on the
    SAME expense (uq_share_expense_member is (expense_id, member_id)). The
    merge must combine them into one row on target_member_id — summed
    amount/base_amount, is_settled = both original shares were settled —
    rather than erroring or silently dropping one side's data.
    """
    owner_headers = _headers("merge-owner-2@example.com", "Merge Owner 2")
    trip = _make_trip(owner_headers)
    trip_id = trip["id"]
    cur_id = _base_currency_id(trip)

    a = _add_member(trip_id, owner_headers, "小明")
    b = _add_member(trip_id, owner_headers, "小華")
    payer = _add_member(trip_id, owner_headers, "付款人")

    # Expense 1: both a and b have shares, NEITHER settled yet.
    expense1 = _make_expense(
        trip_id,
        owner_headers,
        cur_id,
        payer_id=payer["id"],
        name="Expense With Both Unsettled",
        amount=120.0,
        shares=[
            {"member_id": a["id"], "amount": 80.0, "is_settled": False},
            {"member_id": b["id"], "amount": 40.0, "is_settled": False},
        ],
    )
    # Expense 2: both a and b have shares, BOTH already settled.
    expense2 = _make_expense(
        trip_id,
        owner_headers,
        cur_id,
        payer_id=payer["id"],
        name="Expense With Both Settled",
        amount=50.0,
        shares=[
            {"member_id": a["id"], "amount": 30.0, "is_settled": True},
            {"member_id": b["id"], "amount": 20.0, "is_settled": True},
        ],
    )
    # Expense 3: both a and b have shares, only ONE side settled.
    expense3 = _make_expense(
        trip_id,
        owner_headers,
        cur_id,
        payer_id=payer["id"],
        name="Expense With One Settled",
        amount=40.0,
        shares=[
            {"member_id": a["id"], "amount": 25.0, "is_settled": True},
            {"member_id": b["id"], "amount": 15.0, "is_settled": False},
        ],
    )

    resp = client.post(f"/api/trips/{trip_id}/members/{a['id']}/merge-into/{b['id']}", headers=owner_headers)
    assert resp.status_code == 200, resp.text

    all_expenses = {
        e["id"]: e for e in client.get(f"/api/trips/{trip_id}/expenses", headers=owner_headers).json()
    }

    def _share_for(expense_id, member_id):
        shares = [s for s in all_expenses[expense_id]["shares"] if s["member_id"] == member_id]
        assert len(shares) == 1, f"expected exactly one share for member {member_id} on expense {expense_id}"
        return shares[0]

    # Expense 1: combined amount 80+40=120, neither was settled -> not settled.
    s1 = _share_for(expense1["id"], b["id"])
    assert s1["amount"] == pytest_approx(120.0)
    assert s1["is_settled"] is False
    assert not any(s["member_id"] == a["id"] for s in all_expenses[expense1["id"]]["shares"])

    # Expense 2: combined amount 30+20=50, BOTH settled -> combined settled.
    s2 = _share_for(expense2["id"], b["id"])
    assert s2["amount"] == pytest_approx(50.0)
    assert s2["is_settled"] is True

    # Expense 3: combined amount 25+15=40, only one side settled -> NOT settled
    # (still outstanding money shouldn't be silently marked paid).
    s3 = _share_for(expense3["id"], b["id"])
    assert s3["amount"] == pytest_approx(40.0)
    assert s3["is_settled"] is False


def pytest_approx(value):
    import pytest as _pytest

    return _pytest.approx(value)


# ---------- merge direction rule ----------

def test_merge_rejects_deleting_a_linked_member():
    """member_id (the one being deleted) must be unlinked — deleting a
    linked member would silently lose that account's split-participant
    link, so this must 400 with a clear message instead."""
    owner_headers = _headers("merge-owner-3@example.com", "Merge Owner 3")
    trip = _make_trip(owner_headers)
    trip_id = trip["id"]

    # trip["members"][0] is the owner's own auto-added, LINKED member.
    linked_member = trip["members"][0]
    unlinked_target = _add_member(trip_id, owner_headers, "未連結成員")

    resp = client.post(
        f"/api/trips/{trip_id}/members/{linked_member['id']}/merge-into/{unlinked_target['id']}",
        headers=owner_headers,
    )
    assert resp.status_code == 400
    assert "連結" in resp.json()["detail"]

    # Nothing was deleted.
    detail = client.get(f"/api/trips/{trip_id}", headers=owner_headers).json()
    assert any(m["id"] == linked_member["id"] for m in detail["members"])
    assert any(m["id"] == unlinked_target["id"] for m in detail["members"])


def test_merge_allows_unlinked_source_into_linked_target():
    """The one direction that IS allowed: an unlinked member merged into an
    already-linked one — no account link is ever at risk of being lost."""
    owner_headers = _headers("merge-owner-4@example.com", "Merge Owner 4")
    trip = _make_trip(owner_headers)
    trip_id = trip["id"]

    linked_target = trip["members"][0]
    unlinked_source = _add_member(trip_id, owner_headers, "未連結成員")

    resp = client.post(
        f"/api/trips/{trip_id}/members/{unlinked_source['id']}/merge-into/{linked_target['id']}",
        headers=owner_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == linked_target["id"]
    assert resp.json()["user_id"] is not None

    detail = client.get(f"/api/trips/{trip_id}", headers=owner_headers).json()
    assert not any(m["id"] == unlinked_source["id"] for m in detail["members"])


def test_merge_requires_owner_role():
    owner_headers = _headers("merge-owner-5@example.com", "Merge Owner 5")
    member_headers = _headers("merge-member-5@example.com", "Merge Member 5")
    trip = _make_trip(owner_headers)
    trip_id = trip["id"]
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)

    a = _add_member(trip_id, owner_headers, "小明")
    b = _add_member(trip_id, owner_headers, "小華")

    resp = client.post(
        f"/api/trips/{trip_id}/members/{a['id']}/merge-into/{b['id']}", headers=member_headers
    )
    assert resp.status_code == 403


def test_merge_rejects_self_merge_and_unknown_members():
    owner_headers = _headers("merge-owner-6@example.com", "Merge Owner 6")
    trip = _make_trip(owner_headers)
    trip_id = trip["id"]
    a = _add_member(trip_id, owner_headers, "小明")

    self_merge = client.post(
        f"/api/trips/{trip_id}/members/{a['id']}/merge-into/{a['id']}", headers=owner_headers
    )
    assert self_merge.status_code == 400

    missing_source = client.post(
        f"/api/trips/{trip_id}/members/999999/merge-into/{a['id']}", headers=owner_headers
    )
    assert missing_source.status_code == 404

    missing_target = client.post(
        f"/api/trips/{trip_id}/members/{a['id']}/merge-into/999999", headers=owner_headers
    )
    assert missing_target.status_code == 404
