"""Coverage for the "contributor" role — the guest-mode restricted access
added by this round's "訪客也能是完整成員" simplification (see
app/models.py TripAccess's docstring, app/auth.py
require_edit_access/require_expense_create_access, routers/trips.py
join_trip's is_guest branch).

New permission model this locks in:
  - A guest (User.is_guest) who redeems an invite link always lands as
    "contributor", never "editor" — and is never linked to (or causes the
    creation of) a Member row (see test_auth.py's guest/claim_member_id
    tests for that half).
  - A contributor may create a NEW expense (the one deliberate carve-out —
    require_expense_create_access) but nothing else: editing/deleting an
    existing expense, and every write on members/currencies/categories/
    payment-methods/trip-info/invite-link/access-management, is rejected
    exactly like a "viewer" would be (require_edit_access).
  - Every GET a contributor makes still works (require_trip_access is
    unaffected by this role).
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import StaticPool, create_engine
from sqlalchemy.orm import sessionmaker

from app import auth
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


@pytest.fixture(autouse=True)
def _use_this_modules_db():
    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _override_get_db
    yield
    if previous is not None:
        app.dependency_overrides[get_db] = previous
    else:
        app.dependency_overrides.pop(get_db, None)


client = TestClient(app)


class _FakeUser:
    def __init__(self, email: str, name: str = "Test User", user_id: int = 0):
        self.id = user_id
        self.email = email
        self.name = name


def _headers(email: str, name: str = "Test User") -> dict:
    token = auth.create_access_token(_FakeUser(email, name))
    return {"Authorization": f"Bearer {token}"}


def _make_trip_with_contributor(owner_email: str):
    """Owner creates a trip, a guest redeems its invite link. Returns
    (owner_headers, contributor_headers, trip)."""
    owner_headers = _headers(owner_email, "Owner")
    trip = client.post(
        "/api/trips", json={"name": "Contributor Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]

    guest = client.post("/api/auth/guest", json={"name": "代打的朋友"}).json()
    contributor_headers = {"Authorization": f"Bearer {guest['token']}"}
    join_resp = client.post("/api/trips/join", json={"invite_code": invite_code}, headers=contributor_headers)
    assert join_resp.status_code == 200
    assert join_resp.json()["my_role"] == "contributor"

    return owner_headers, contributor_headers, trip


# ---------- contributor can create expenses, nothing else ----------

def test_contributor_can_create_expense():
    owner_headers, contributor_headers, trip = _make_trip_with_contributor("contrib-create-owner@example.com")
    trip_id = trip["id"]
    payer_id = trip["members"][0]["id"]
    currency_id = trip["currencies"][0]["id"]

    resp = client.post(
        f"/api/trips/{trip_id}/expenses",
        json={
            "date": "2026-08-13",
            "name": "訪客代打的一筆",
            "amount": 250,
            "currency_id": currency_id,
            "payer_id": payer_id,
            "needs_split": False,
        },
        headers=contributor_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["name"] == "訪客代打的一筆"


def test_contributor_cannot_edit_or_delete_expenses():
    owner_headers, contributor_headers, trip = _make_trip_with_contributor("contrib-edit-owner@example.com")
    trip_id = trip["id"]
    payer_id = trip["members"][0]["id"]
    currency_id = trip["currencies"][0]["id"]

    # An expense created by the owner...
    expense = client.post(
        f"/api/trips/{trip_id}/expenses",
        json={
            "date": "2026-08-13",
            "amount": 100,
            "currency_id": currency_id,
            "payer_id": payer_id,
            "needs_split": False,
        },
        headers=owner_headers,
    ).json()

    resp = client.put(
        f"/api/trips/{trip_id}/expenses/{expense['id']}", json={"amount": 200}, headers=contributor_headers
    )
    assert resp.status_code == 403

    resp = client.delete(f"/api/trips/{trip_id}/expenses/{expense['id']}", headers=contributor_headers)
    assert resp.status_code == 403

    # ...and an expense the contributor created themselves is equally
    # off-limits to edit/delete — "can only ADD a new one" applies to their
    # own entries too, not just other people's.
    own_expense = client.post(
        f"/api/trips/{trip_id}/expenses",
        json={
            "date": "2026-08-13",
            "amount": 50,
            "currency_id": currency_id,
            "payer_id": payer_id,
            "needs_split": False,
        },
        headers=contributor_headers,
    ).json()
    resp = client.put(
        f"/api/trips/{trip_id}/expenses/{own_expense['id']}", json={"amount": 60}, headers=contributor_headers
    )
    assert resp.status_code == 403
    resp = client.delete(f"/api/trips/{trip_id}/expenses/{own_expense['id']}", headers=contributor_headers)
    assert resp.status_code == 403

    # Reads still work.
    assert client.get(f"/api/trips/{trip_id}/expenses", headers=contributor_headers).status_code == 200


def test_contributor_cannot_write_members_currencies_categories_payment_methods_or_trip_info():
    owner_headers, contributor_headers, trip = _make_trip_with_contributor("contrib-write-owner@example.com")
    trip_id = trip["id"]

    # Members
    assert (
        client.post(f"/api/trips/{trip_id}/members", json={"name": "X"}, headers=contributor_headers).status_code
        == 403
    )
    existing_member_id = trip["members"][0]["id"]
    assert (
        client.put(f"/api/members/{existing_member_id}", json={"name": "Y"}, headers=contributor_headers).status_code
        == 403
    )
    assert client.delete(f"/api/members/{existing_member_id}", headers=contributor_headers).status_code == 403
    assert client.get(f"/api/trips/{trip_id}/members", headers=contributor_headers).status_code == 200

    # Currencies
    assert (
        client.post(
            f"/api/trips/{trip_id}/currencies",
            json={"code": "JPY", "rate_to_base": 0.2},
            headers=contributor_headers,
        ).status_code
        == 403
    )
    base_currency_id = trip["currencies"][0]["id"]
    assert (
        client.put(
            f"/api/currencies/{base_currency_id}", json={"name": "x"}, headers=contributor_headers
        ).status_code
        == 403
    )
    assert client.get(f"/api/trips/{trip_id}/currencies", headers=contributor_headers).status_code == 200

    # Categories
    assert (
        client.post(
            f"/api/trips/{trip_id}/categories", json={"name": "測試分類"}, headers=contributor_headers
        ).status_code
        == 403
    )
    existing_category_id = trip["categories"][0]["id"]
    assert (
        client.put(
            f"/api/categories/{existing_category_id}", json={"name": "x"}, headers=contributor_headers
        ).status_code
        == 403
    )
    assert client.delete(f"/api/categories/{existing_category_id}", headers=contributor_headers).status_code == 403
    assert client.post(f"/api/trips/{trip_id}/categories/reset", headers=contributor_headers).status_code == 403
    assert client.get(f"/api/trips/{trip_id}/categories", headers=contributor_headers).status_code == 200

    # Payment methods
    assert (
        client.post(
            f"/api/trips/{trip_id}/payment-methods", json={"name": "測試方式"}, headers=contributor_headers
        ).status_code
        == 403
    )
    existing_pm_id = trip["payment_methods"][0]["id"]
    assert (
        client.put(
            f"/api/payment-methods/{existing_pm_id}", json={"name": "x"}, headers=contributor_headers
        ).status_code
        == 403
    )
    assert client.delete(f"/api/payment-methods/{existing_pm_id}", headers=contributor_headers).status_code == 403
    assert client.post(f"/api/trips/{trip_id}/payment-methods/reset", headers=contributor_headers).status_code == 403
    assert client.get(f"/api/trips/{trip_id}/payment-methods", headers=contributor_headers).status_code == 200

    # Trip info itself
    assert client.put(f"/api/trips/{trip_id}", json={"name": "改名"}, headers=contributor_headers).status_code == 403
    assert client.get(f"/api/trips/{trip_id}", headers=contributor_headers).status_code == 200

    # Owner-only / invite-link / access-management ops.
    assert client.delete(f"/api/trips/{trip_id}", headers=contributor_headers).status_code == 403
    assert client.post(f"/api/trips/{trip_id}/invite", headers=contributor_headers).status_code == 403
    access_list = client.get(f"/api/trips/{trip_id}/access", headers=owner_headers).json()
    contributor_user_id = next(row["user_id"] for row in access_list if row["role"] == "contributor")
    assert (
        client.delete(f"/api/trips/{trip_id}/access/{contributor_user_id}", headers=contributor_headers).status_code
        == 403
    )
    assert (
        client.put(
            f"/api/trips/{trip_id}/access/{contributor_user_id}",
            json={"role": "editor"},
            headers=contributor_headers,
        ).status_code
        == 403
    )


def test_contributor_role_cannot_be_manually_assigned_via_role_switch_endpoint():
    """"contributor" is only ever produced by a guest redeeming an invite
    link (routers/trips.py join_trip) — the owner-only role-switch endpoint
    must not be able to promote/demote anyone INTO it. TripAccessRoleUpdate's
    Literal["editor", "viewer"] rejects "contributor" at request validation,
    before the endpoint body even runs."""
    owner_headers = _headers("contrib-noassign-owner@example.com", "No Assign Owner")
    trip = client.post(
        "/api/trips", json={"name": "No Assign Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]
    other_headers = _headers("contrib-noassign-other@example.com", "No Assign Other")
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=other_headers)

    access_rows = client.get(f"/api/trips/{trip['id']}/access", headers=owner_headers).json()
    other_user_id = next(a["user_id"] for a in access_rows if not a["is_me"])

    resp = client.put(
        f"/api/trips/{trip['id']}/access/{other_user_id}", json={"role": "contributor"}, headers=owner_headers
    )
    assert resp.status_code == 422


def test_owner_cannot_switch_an_existing_contributors_role_away_from_contributor():
    """The reverse direction of the guard above: even the trip OWNER must not
    be able to take an existing "contributor" (guest) row and switch it to
    "editor"/"viewer" via PUT /api/trips/{trip_id}/access/{user_id}. Before
    this round's fix, update_trip_access_role only rejected `target.role ==
    "owner"` — a guest contributor had no such protection, so an owner could
    promote a guest into "editor" by hand, producing exactly the "guest with
    a non-contributor role" combination the rest of the app (join_trip,
    PeopleSection.tsx's accessOnlyRows rendering) assumes can never happen."""
    owner_headers, contributor_headers, trip = _make_trip_with_contributor("contrib-noreassign-owner@example.com")
    trip_id = trip["id"]

    access_list = client.get(f"/api/trips/{trip_id}/access", headers=owner_headers).json()
    contributor_user_id = next(row["user_id"] for row in access_list if row["role"] == "contributor")

    resp = client.put(
        f"/api/trips/{trip_id}/access/{contributor_user_id}", json={"role": "editor"}, headers=owner_headers
    )
    assert resp.status_code == 400
    assert "訪客" in resp.json()["detail"]

    # Role must be unchanged after the rejected attempt.
    access_list_after = client.get(f"/api/trips/{trip_id}/access", headers=owner_headers).json()
    assert next(row["role"] for row in access_list_after if row["user_id"] == contributor_user_id) == "contributor"
