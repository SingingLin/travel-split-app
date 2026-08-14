"""Coverage for GET /api/trips (list_trips / trip_summaries_for_user) and
DELETE /api/trips/{trip_id}/access/{user_id} (remove_trip_access) — added
alongside the frontend's PeopleSection.tsx / TripSidebar.tsx rework.

Two things this locks in:
  - create_trip always auto-links the creator's own Member.user_id (see
    routers/trips.py create_trip) — i.e. "trip owner with no Member row"
    (the PeopleSection.tsx UI bug this round fixes the *symptom* of) can
    never happen for a trip created through the normal, current flow. If
    this test ever starts failing, that conclusion no longer holds and the
    frontend fix alone wouldn't be enough anymore.
  - remove_trip_access still rejects an owner removing their own access
    (400, friendly Chinese detail) rather than ever letting that request
    reach a state the frontend has to recover from after the fact.
  - TripSummaryOut.my_role (new field, powers TripSidebar.tsx's owner-only
    "刪除行程" gating) reports the CALLING user's own role correctly, not
    some other viewer's.
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
    # Same save/restore pattern as test_auth.py / test_members_merge.py —
    # each test module points get_db at its own isolated in-memory engine.
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


def _make_trip(owner_headers, name="Trip"):
    resp = client.post("/api/trips", json={"name": name, "base_currency_code": "TWD"}, headers=owner_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------- "owner with no Member" audit ----------

def test_create_trip_auto_links_creators_member_so_owner_always_has_a_member():
    """The exact scenario the user's screenshot showed (owner shows up in
    PeopleSection.tsx's "有存取權、尚未加入分帳" list) requires the owner's
    TripAccess to exist with no matching Member.user_id. create_trip must
    never produce that state for a freshly created trip."""
    owner_headers = _headers("trip-owner-1@example.com", "Trip Owner")
    trip = _make_trip(owner_headers)

    assert len(trip["members"]) == 1
    creator_member = trip["members"][0]
    assert creator_member["user_id"] is not None

    access_rows = client.get(f"/api/trips/{trip['id']}/access", headers=owner_headers).json()
    owner_row = next(a for a in access_rows if a["role"] == "owner")
    assert owner_row["user_id"] == creator_member["user_id"]


# ---------- remove_trip_access ----------

def test_remove_trip_access_rejects_owner_removing_own_access():
    owner_headers = _headers("trip-owner-2@example.com", "Trip Owner 2")
    trip = _make_trip(owner_headers)
    owner_user_id = trip["members"][0]["user_id"]

    resp = client.delete(f"/api/trips/{trip['id']}/access/{owner_user_id}", headers=owner_headers)
    assert resp.status_code == 400
    assert "自己" in resp.json()["detail"]

    # Nothing was removed — the owner still has access.
    access_rows = client.get(f"/api/trips/{trip['id']}/access", headers=owner_headers).json()
    assert any(a["user_id"] == owner_user_id and a["role"] == "owner" for a in access_rows)


def test_remove_trip_access_allows_owner_removing_a_different_member():
    owner_headers = _headers("trip-owner-3@example.com", "Trip Owner 3")
    member_headers = _headers("trip-member-3@example.com", "Trip Member 3")
    trip = _make_trip(owner_headers)
    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)

    access_rows = client.get(f"/api/trips/{trip['id']}/access", headers=owner_headers).json()
    member_row = next(a for a in access_rows if a["role"] == "editor")

    resp = client.delete(f"/api/trips/{trip['id']}/access/{member_row['user_id']}", headers=owner_headers)
    assert resp.status_code == 204

    access_rows_after = client.get(f"/api/trips/{trip['id']}/access", headers=owner_headers).json()
    assert not any(a["user_id"] == member_row["user_id"] for a in access_rows_after)


def test_remove_trip_access_rejects_non_owner_caller():
    owner_headers = _headers("trip-owner-4@example.com", "Trip Owner 4")
    member_headers = _headers("trip-member-4@example.com", "Trip Member 4")
    trip = _make_trip(owner_headers)
    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)
    owner_user_id = trip["members"][0]["user_id"]

    resp = client.delete(f"/api/trips/{trip['id']}/access/{owner_user_id}", headers=member_headers)
    assert resp.status_code == 403


def test_remove_trip_access_404s_for_a_user_with_no_access_row():
    owner_headers = _headers("trip-owner-5@example.com", "Trip Owner 5")
    trip = _make_trip(owner_headers)

    resp = client.delete(f"/api/trips/{trip['id']}/access/999999", headers=owner_headers)
    assert resp.status_code == 404


# ---------- remove_trip_access also deletes the linked split-Member ----------
# (the "存取權" + "分帳身分" merge — see routers/trips.py remove_trip_access's
# docstring / this round's task spec: a linked account's access and split
# identity must always disappear together, never leaving one without the
# other.)

def test_remove_trip_access_also_deletes_the_linked_member():
    owner_headers = _headers("merge-owner-1@example.com", "Merge Owner 1")
    member_headers = _headers("merge-member-1@example.com", "Merge Member 1")
    trip = _make_trip(owner_headers)
    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]
    joined = client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers).json()

    # Joining auto-links a Member for this user (see routers/trips.py
    # join_trip) — confirm it exists before removal.
    members_before = client.get(f"/api/trips/{trip['id']}/members", headers=owner_headers).json()
    joined_member = next(m for m in members_before if m["user_id"] is not None and m["id"] != joined["members"][0]["id"])
    assert joined_member is not None

    resp = client.delete(f"/api/trips/{trip['id']}/access/{joined_member['user_id']}", headers=owner_headers)
    assert resp.status_code == 204

    # Both the TripAccess row AND the linked Member are now gone.
    access_rows_after = client.get(f"/api/trips/{trip['id']}/access", headers=owner_headers).json()
    assert not any(a["user_id"] == joined_member["user_id"] for a in access_rows_after)

    members_after = client.get(f"/api/trips/{trip['id']}/members", headers=owner_headers).json()
    assert not any(m["id"] == joined_member["id"] for m in members_after)


def test_remove_trip_access_does_not_touch_unlinked_members():
    """Removing a linked user's access must never delete OTHER (unlinked)
    Member rows on the same trip — only their own linked Member, if any."""
    owner_headers = _headers("merge-owner-2@example.com", "Merge Owner 2")
    member_headers = _headers("merge-member-2@example.com", "Merge Member 2")
    trip = _make_trip(owner_headers)

    unlinked = client.post(
        f"/api/trips/{trip['id']}/members", json={"name": "路人甲"}, headers=owner_headers
    ).json()

    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)

    members = client.get(f"/api/trips/{trip['id']}/members", headers=owner_headers).json()
    joined_member = next(m for m in members if m["id"] not in (trip["members"][0]["id"], unlinked["id"]))

    resp = client.delete(f"/api/trips/{trip['id']}/access/{joined_member['user_id']}", headers=owner_headers)
    assert resp.status_code == 204

    members_after = client.get(f"/api/trips/{trip['id']}/members", headers=owner_headers).json()
    assert any(m["id"] == unlinked["id"] for m in members_after)


# ---------- TripSummaryOut.my_role ----------

def test_list_trips_reports_the_calling_users_own_role():
    owner_headers = _headers("trip-owner-6@example.com", "Trip Owner 6")
    member_headers = _headers("trip-member-6@example.com", "Trip Member 6")
    trip = _make_trip(owner_headers)
    invite_code = client.post(f"/api/trips/{trip['id']}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)

    owner_view = client.get("/api/trips", headers=owner_headers).json()
    owner_trip = next(t for t in owner_view if t["id"] == trip["id"])
    assert owner_trip["my_role"] == "owner"

    member_view = client.get("/api/trips", headers=member_headers).json()
    member_trip = next(t for t in member_view if t["id"] == trip["id"])
    assert member_trip["my_role"] == "editor"
