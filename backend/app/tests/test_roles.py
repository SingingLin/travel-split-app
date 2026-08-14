"""Coverage for the "擁有者／可編輯／唯讀" role simplification —
app/auth.py's require_edit_access dependency and the owner-only role-switch
endpoint (PUT /api/trips/{trip_id}/access/{user_id}).

Three things this locks in:
  - A "viewer"-role caller is rejected (403) by every write endpoint this
    round moved onto require_edit_access, but every GET still works exactly
    as before (require_trip_access unchanged).
  - An owner can switch another user's role between "editor" and "viewer"
    via PUT /api/trips/{trip_id}/access/{user_id}, and it takes effect
    immediately (the switched user's next write attempt is judged by the
    new role).
  - Nobody can be promoted to "owner" through that endpoint (rejected at
    request-validation), the owner can't change their own role (including
    self-demotion), and the owner can't change another owner's role.
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


def _make_trip_with_viewer(owner_email: str, viewer_email: str):
    """Owner creates a trip, `viewer_email` joins via invite (as "editor" by
    default), then the owner demotes them to "viewer". Returns
    (owner_headers, viewer_headers, trip, viewer_user_id)."""
    owner_headers = _headers(owner_email, "Owner")
    viewer_headers = _headers(viewer_email, "Viewer")

    trip = client.post(
        "/api/trips", json={"name": "Role Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=viewer_headers)

    access_rows = client.get(f"/api/trips/{trip['id']}/access", headers=owner_headers).json()
    viewer_user_id = next(a["user_id"] for a in access_rows if not a["is_me"])

    resp = client.put(
        f"/api/trips/{trip['id']}/access/{viewer_user_id}",
        json={"role": "viewer"},
        headers=owner_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "viewer"

    return owner_headers, viewer_headers, trip, viewer_user_id


# ---------- viewer: every write is rejected, every read still works ----------

def test_viewer_cannot_create_expense_but_can_list_expenses():
    owner_headers, viewer_headers, trip, _ = _make_trip_with_viewer(
        "viewer-owner-1@example.com", "viewer-1@example.com"
    )
    trip_id = trip["id"]
    payer_id = trip["members"][0]["id"]
    currency_id = trip["currencies"][0]["id"]

    resp = client.get(f"/api/trips/{trip_id}/expenses", headers=viewer_headers)
    assert resp.status_code == 200

    resp = client.post(
        f"/api/trips/{trip_id}/expenses",
        json={
            "date": "2026-01-01",
            "amount": 100,
            "currency_id": currency_id,
            "payer_id": payer_id,
            "needs_split": False,
        },
        headers=viewer_headers,
    )
    assert resp.status_code == 403
    assert "唯讀" in resp.json()["detail"]

    # Owner-created expense: viewer can't edit or delete it either.
    expense = client.post(
        f"/api/trips/{trip_id}/expenses",
        json={
            "date": "2026-01-01",
            "amount": 100,
            "currency_id": currency_id,
            "payer_id": payer_id,
            "needs_split": False,
        },
        headers=owner_headers,
    ).json()
    resp = client.put(
        f"/api/trips/{trip_id}/expenses/{expense['id']}", json={"amount": 200}, headers=viewer_headers
    )
    assert resp.status_code == 403
    resp = client.delete(f"/api/trips/{trip_id}/expenses/{expense['id']}", headers=viewer_headers)
    assert resp.status_code == 403

    # Read-only access to that same expense is unaffected.
    resp = client.get(f"/api/trips/{trip_id}/expenses/{expense['id']}", headers=viewer_headers)
    assert resp.status_code == 200


def test_viewer_cannot_write_members_currencies_categories_payment_methods_or_trip_info():
    owner_headers, viewer_headers, trip, _ = _make_trip_with_viewer(
        "viewer-owner-2@example.com", "viewer-2@example.com"
    )
    trip_id = trip["id"]

    # Members
    assert client.post(f"/api/trips/{trip_id}/members", json={"name": "X"}, headers=viewer_headers).status_code == 403
    existing_member_id = trip["members"][0]["id"]
    assert (
        client.put(f"/api/members/{existing_member_id}", json={"name": "Y"}, headers=viewer_headers).status_code
        == 403
    )
    assert client.delete(f"/api/members/{existing_member_id}", headers=viewer_headers).status_code == 403
    # But GET still works.
    assert client.get(f"/api/trips/{trip_id}/members", headers=viewer_headers).status_code == 200

    # Currencies
    assert (
        client.post(
            f"/api/trips/{trip_id}/currencies",
            json={"code": "JPY", "rate_to_base": 0.2},
            headers=viewer_headers,
        ).status_code
        == 403
    )
    base_currency_id = trip["currencies"][0]["id"]
    assert (
        client.put(
            f"/api/currencies/{base_currency_id}", json={"name": "x"}, headers=viewer_headers
        ).status_code
        == 403
    )
    assert client.get(f"/api/trips/{trip_id}/currencies", headers=viewer_headers).status_code == 200

    # Categories
    assert (
        client.post(f"/api/trips/{trip_id}/categories", json={"name": "測試分類"}, headers=viewer_headers).status_code
        == 403
    )
    existing_category_id = trip["categories"][0]["id"]
    assert (
        client.put(f"/api/categories/{existing_category_id}", json={"name": "x"}, headers=viewer_headers).status_code
        == 403
    )
    assert client.delete(f"/api/categories/{existing_category_id}", headers=viewer_headers).status_code == 403
    assert client.post(f"/api/trips/{trip_id}/categories/reset", headers=viewer_headers).status_code == 403
    assert client.get(f"/api/trips/{trip_id}/categories", headers=viewer_headers).status_code == 200

    # Payment methods
    assert (
        client.post(
            f"/api/trips/{trip_id}/payment-methods", json={"name": "測試方式"}, headers=viewer_headers
        ).status_code
        == 403
    )
    existing_pm_id = trip["payment_methods"][0]["id"]
    assert (
        client.put(f"/api/payment-methods/{existing_pm_id}", json={"name": "x"}, headers=viewer_headers).status_code
        == 403
    )
    assert client.delete(f"/api/payment-methods/{existing_pm_id}", headers=viewer_headers).status_code == 403
    assert client.post(f"/api/trips/{trip_id}/payment-methods/reset", headers=viewer_headers).status_code == 403
    assert client.get(f"/api/trips/{trip_id}/payment-methods", headers=viewer_headers).status_code == 200

    # Trip info itself
    assert client.put(f"/api/trips/{trip_id}", json={"name": "改名"}, headers=viewer_headers).status_code == 403
    assert client.get(f"/api/trips/{trip_id}", headers=viewer_headers).status_code == 200

    # Owner-only ops stay rejected for a viewer too (403, same as before —
    # a viewer was never going to pass the owner check anyway, but confirm
    # require_edit_access itself is what blocks them first).
    assert client.delete(f"/api/trips/{trip_id}", headers=viewer_headers).status_code == 403
    assert client.post(f"/api/trips/{trip_id}/invite", headers=viewer_headers).status_code == 403


# ---------- owner switches roles ----------

def test_owner_can_switch_editor_to_viewer_and_back():
    owner_headers = _headers("switch-owner-1@example.com", "Switch Owner")
    other_headers = _headers("switch-other-1@example.com", "Switch Other")
    trip = client.post(
        "/api/trips", json={"name": "Switch Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=other_headers)

    access_rows = client.get(f"/api/trips/{trip['id']}/access", headers=owner_headers).json()
    other_user_id = next(a["user_id"] for a in access_rows if not a["is_me"])
    assert next(a["role"] for a in access_rows if not a["is_me"]) == "editor"

    resp = client.put(
        f"/api/trips/{trip['id']}/access/{other_user_id}", json={"role": "viewer"}, headers=owner_headers
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"

    access_rows = client.get(f"/api/trips/{trip['id']}/access", headers=owner_headers).json()
    assert next(a["role"] for a in access_rows if not a["is_me"]) == "viewer"

    resp = client.put(
        f"/api/trips/{trip['id']}/access/{other_user_id}", json={"role": "editor"}, headers=owner_headers
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "editor"


def test_role_switch_is_owner_only():
    owner_headers = _headers("switch-owner-2@example.com", "Switch Owner 2")
    other_headers = _headers("switch-other-2@example.com", "Switch Other 2")
    trip = client.post(
        "/api/trips", json={"name": "Switch Trip 2", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=other_headers)
    owner_user_id = trip["members"][0]["user_id"]

    resp = client.put(
        f"/api/trips/{trip['id']}/access/{owner_user_id}", json={"role": "viewer"}, headers=other_headers
    )
    assert resp.status_code == 403


def test_owner_cannot_change_own_role():
    owner_headers = _headers("switch-owner-3@example.com", "Switch Owner 3")
    trip = client.post(
        "/api/trips", json={"name": "Switch Trip 3", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    owner_user_id = trip["members"][0]["user_id"]

    resp = client.put(
        f"/api/trips/{trip['id']}/access/{owner_user_id}", json={"role": "viewer"}, headers=owner_headers
    )
    assert resp.status_code == 400
    assert "自己" in resp.json()["detail"]


def test_owner_cannot_change_another_owners_role():
    """Defensive: even if a second TripAccess row somehow has role='owner'
    (e.g. a future ownership-transfer feature), this endpoint refuses to
    touch it — not just "can't promote TO owner" but also "can't touch an
    existing owner"."""
    owner_headers = _headers("switch-owner-4@example.com", "Switch Owner 4")
    trip = client.post(
        "/api/trips", json={"name": "Switch Trip 4", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()

    # Manually create a second "owner" row directly via the DB session, since
    # there's no API path that produces two owners on one trip today.
    db = TestingSessionLocal()
    try:
        from app import models

        second_owner = models.User(email="second-owner@example.com", name="Second Owner")
        db.add(second_owner)
        db.flush()
        db.add(models.TripAccess(trip_id=trip["id"], user_id=second_owner.id, role="owner"))
        db.commit()
        second_owner_id = second_owner.id
    finally:
        db.close()

    resp = client.put(
        f"/api/trips/{trip['id']}/access/{second_owner_id}", json={"role": "viewer"}, headers=owner_headers
    )
    assert resp.status_code == 400
    assert "擁有者" in resp.json()["detail"]


def test_role_switch_cannot_promote_to_owner():
    owner_headers = _headers("switch-owner-5@example.com", "Switch Owner 5")
    other_headers = _headers("switch-other-5@example.com", "Switch Other 5")
    trip = client.post(
        "/api/trips", json={"name": "Switch Trip 5", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=other_headers)
    access_rows = client.get(f"/api/trips/{trip['id']}/access", headers=owner_headers).json()
    other_user_id = next(a["user_id"] for a in access_rows if not a["is_me"])

    resp = client.put(
        f"/api/trips/{trip['id']}/access/{other_user_id}", json={"role": "owner"}, headers=owner_headers
    )
    # Rejected at request validation (Literal["editor", "viewer"]) — 422, not 400/403.
    assert resp.status_code == 422
