"""Coverage for the Google-login-adjacent auth layer added this round (see
app/auth.py, app/models.py User/TripAccess, app/routers/trips.py invite/join
endpoints).

This round doesn't wire up real Google login (that's next round's frontend
work) — instead every protected endpoint trusts a custom-signed JWT the
frontend is assumed to already have attached as `Authorization: Bearer
<token>`. So these tests sign their own test JWTs directly (via
app.auth.create_access_token, the same function next round's real login flow
will call) and never touch Google at all.

Covers: JWT sign/verify round-trip + expiry/signature failures,
get_current_user's upsert-on-first-request behavior, require_trip_access's
403 on no access, the invite/join flow (including idempotent re-join and an
invalid code), and every owner-only operation's guardrails (delete trip,
revoke access, can't revoke self) — plus the core security guarantee of this
whole round: a user with zero access to a trip is blocked (403) from every
kind of endpoint touching that trip, not just some of them.
"""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import datetime as dt

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import StaticPool, create_engine
from sqlalchemy.orm import sessionmaker

from app import auth, models
from app.database import Base, get_db
from app.main import app

# Isolated in-memory DB per test module, same StaticPool pattern as
# test_expenses_rate.py (plain "sqlite:///:memory:" would give every new
# connection its own empty DB, which breaks under TestClient's threaded
# requests).
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


client = TestClient(app)


@pytest.fixture(autouse=True)
def _use_this_modules_db():
    """`app.dependency_overrides` is a single global dict on the shared
    `app` singleton, and test_expenses_rate.py *also* points get_db at its
    own separate in-memory engine at import time. Pytest imports every test
    module during collection (before any test actually runs), so whichever
    module's import happened to run last would otherwise "win" for every
    test in the whole session, regardless of which file's tests are
    currently executing — silently running this module's requests against
    a different module's database. Save/restore around each test here keeps
    this module's tests correctly isolated to its own engine no matter the
    collection order, and hands the override back to whatever it was
    (typically test_expenses_rate.py's) afterward so that module's own tests
    keep working too."""
    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _override_get_db
    yield
    if previous is not None:
        app.dependency_overrides[get_db] = previous
    else:
        app.dependency_overrides.pop(get_db, None)


class _FakeUser:
    """Duck-types just enough of models.User (id/email/name) for
    create_access_token — lets tests sign a token for an email that has no
    corresponding User row yet, exactly like a real first-time Google login
    would (get_current_user upserts it on first use)."""

    def __init__(self, email: str, name: str = "Test User", user_id: int = 0):
        self.id = user_id
        self.email = email
        self.name = name


def _token_for(email: str, name: str = "Test User") -> str:
    return auth.create_access_token(_FakeUser(email, name))


def _headers(email: str, name: str = "Test User") -> dict:
    return {"Authorization": f"Bearer {_token_for(email, name)}"}


def _raw_token(payload: dict, secret: str | None = None, algorithm: str = auth.JWT_ALGORITHM) -> str:
    return jwt.encode(payload, secret if secret is not None else auth.APP_JWT_SECRET, algorithm=algorithm)


# ---------- create_access_token / decode_access_token ----------

def test_create_and_decode_access_token_round_trip():
    user = _FakeUser("alice@example.com", "Alice", user_id=42)
    token = auth.create_access_token(user)
    payload = auth.decode_access_token(token)
    assert payload["sub"] == "42"
    assert payload["email"] == "alice@example.com"
    assert payload["name"] == "Alice"
    assert "exp" in payload and "iat" in payload


def test_decode_access_token_rejects_expired_token():
    now = dt.datetime.now(dt.timezone.utc)
    expired = _raw_token(
        {
            "sub": "1",
            "email": "expired@example.com",
            "name": "Expired",
            "iat": now - dt.timedelta(days=10),
            "exp": now - dt.timedelta(days=3),
        }
    )
    with pytest.raises(jwt.ExpiredSignatureError):
        auth.decode_access_token(expired)


def test_decode_access_token_rejects_bad_signature():
    now = dt.datetime.now(dt.timezone.utc)
    forged = _raw_token(
        {
            "sub": "1",
            "email": "forged@example.com",
            "name": "Forged",
            "iat": now,
            "exp": now + dt.timedelta(days=7),
        },
        secret="not-the-real-app-jwt-secret",
    )
    with pytest.raises(jwt.InvalidTokenError):
        auth.decode_access_token(forged)


# ---------- get_current_user ----------

def test_missing_authorization_header_is_401():
    resp = client.get("/api/trips")
    assert resp.status_code == 401


def test_invalid_token_is_401():
    resp = client.get("/api/trips", headers={"Authorization": "Bearer not-a-real-jwt"})
    assert resp.status_code == 401


def test_expired_token_is_401():
    now = dt.datetime.now(dt.timezone.utc)
    expired = _raw_token(
        {
            "sub": "1",
            "email": "expired-request@example.com",
            "name": "Expired",
            "iat": now - dt.timedelta(days=10),
            "exp": now - dt.timedelta(days=1),
        }
    )
    resp = client.get("/api/trips", headers={"Authorization": f"Bearer {expired}"})
    assert resp.status_code == 401


def test_get_current_user_creates_user_on_first_request_then_reuses_it():
    email = "new-user@example.com"
    # First request: no User row for this email yet -> upserted.
    resp1 = client.get("/api/trips", headers=_headers(email, "New User"))
    assert resp1.status_code == 200

    db = TestingSessionLocal()
    try:
        users = db.query(models.User).filter(models.User.email == email).all()
        assert len(users) == 1
        assert users[0].name == "New User"
    finally:
        db.close()

    # Second request with the same email: reuses the existing row, doesn't
    # create a duplicate (User.email has a unique index).
    resp2 = client.get("/api/trips", headers=_headers(email, "New User"))
    assert resp2.status_code == 200
    db = TestingSessionLocal()
    try:
        count = db.query(models.User).filter(models.User.email == email).count()
        assert count == 1
    finally:
        db.close()


# ---------- require_trip_access ----------

def test_require_trip_access_blocks_user_with_no_access():
    owner_headers = _headers("owner-a@example.com", "Owner A")
    trip = client.post("/api/trips", json={"name": "A's Trip", "base_currency_code": "TWD"}, headers=owner_headers).json()
    trip_id = trip["id"]

    stranger_headers = _headers("stranger@example.com", "Stranger")
    resp = client.get(f"/api/trips/{trip_id}", headers=stranger_headers)
    assert resp.status_code == 403


def test_require_trip_access_allows_owner_and_reports_owner_role():
    owner_headers = _headers("owner-b@example.com", "Owner B")
    trip = client.post("/api/trips", json={"name": "B's Trip", "base_currency_code": "TWD"}, headers=owner_headers).json()
    trip_id = trip["id"]

    resp = client.get(f"/api/trips/{trip_id}", headers=owner_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] == trip_id


# ---------- create_trip / list_trips scoping ----------

def test_create_trip_grants_creator_owner_access_and_list_trips_is_scoped():
    headers_a = _headers("scoped-a@example.com", "Scoped A")
    headers_b = _headers("scoped-b@example.com", "Scoped B")

    trip_a = client.post("/api/trips", json={"name": "Scoped Trip A", "base_currency_code": "TWD"}, headers=headers_a).json()

    list_a = client.get("/api/trips", headers=headers_a).json()
    assert any(t["id"] == trip_a["id"] for t in list_a)

    list_b = client.get("/api/trips", headers=headers_b).json()
    assert all(t["id"] != trip_a["id"] for t in list_b)


# ---------- invite / join ----------

def test_invite_requires_owner_role():
    owner_headers = _headers("invite-owner@example.com", "Invite Owner")
    member_headers = _headers("invite-member@example.com", "Invite Member")

    trip = client.post("/api/trips", json={"name": "Invite Trip", "base_currency_code": "TWD"}, headers=owner_headers).json()
    trip_id = trip["id"]

    invite_resp = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers)
    assert invite_resp.status_code == 200
    invite_code = invite_resp.json()["invite_code"]
    assert len(invite_code) > 10

    join_resp = client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)
    assert join_resp.status_code == 200
    assert join_resp.json()["id"] == trip_id

    # Now that member_headers has joined (as "editor"), they still can't
    # generate an invite themselves.
    forbidden = client.post(f"/api/trips/{trip_id}/invite", headers=member_headers)
    assert forbidden.status_code == 403


def test_invite_code_is_stable_across_repeated_calls():
    owner_headers = _headers("stable-invite-owner@example.com", "Stable Owner")
    trip = client.post("/api/trips", json={"name": "Stable Invite Trip", "base_currency_code": "TWD"}, headers=owner_headers).json()
    trip_id = trip["id"]

    first = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]
    second = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]
    assert first == second


def test_join_with_invalid_invite_code_is_404():
    resp = client.post(
        "/api/trips/join",
        json={"invite_code": "this-code-does-not-exist"},
        headers=_headers("no-such-code@example.com"),
    )
    assert resp.status_code == 404


def test_join_is_idempotent_no_duplicate_access_row():
    owner_headers = _headers("idempotent-owner@example.com", "Idempotent Owner")
    member_headers = _headers("idempotent-member@example.com", "Idempotent Member")

    trip = client.post("/api/trips", json={"name": "Idempotent Trip", "base_currency_code": "TWD"}, headers=owner_headers).json()
    trip_id = trip["id"]
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]

    r1 = client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)
    assert r1.status_code == 200
    r2 = client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)
    assert r2.status_code == 200

    access_list = client.get(f"/api/trips/{trip_id}/access", headers=owner_headers).json()
    member_rows = [row for row in access_list if row["email"] == "idempotent-member@example.com"]
    assert len(member_rows) == 1
    assert member_rows[0]["role"] == "editor"


def test_joined_member_can_view_and_add_expenses():
    owner_headers = _headers("joinflow-owner@example.com", "Joinflow Owner")
    member_headers = _headers("joinflow-member@example.com", "Joinflow Member")

    trip = client.post("/api/trips", json={"name": "Joinflow Trip", "base_currency_code": "TWD"}, headers=owner_headers).json()
    trip_id = trip["id"]
    base_currency_id = next(c["id"] for c in trip["currencies"] if c["is_base"])
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)

    member_row = client.post(f"/api/trips/{trip_id}/members", json={"name": "Joined Member"}, headers=member_headers).json()

    expense_resp = client.post(
        f"/api/trips/{trip_id}/expenses",
        json={
            "date": "2026-08-13",
            "name": "測試支出",
            "amount": 100.0,
            "currency_id": base_currency_id,
            "payer_id": member_row["id"],
            "needs_split": False,
            "shares": [],
            "type": "expense",
        },
        headers=member_headers,
    )
    assert expense_resp.status_code == 201


# ---------- owner-only operations ----------

def test_delete_trip_requires_owner_role():
    owner_headers = _headers("delete-owner@example.com", "Delete Owner")
    member_headers = _headers("delete-member@example.com", "Delete Member")

    trip = client.post("/api/trips", json={"name": "Delete Trip", "base_currency_code": "TWD"}, headers=owner_headers).json()
    trip_id = trip["id"]
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)

    forbidden = client.delete(f"/api/trips/{trip_id}", headers=member_headers)
    assert forbidden.status_code == 403

    allowed = client.delete(f"/api/trips/{trip_id}", headers=owner_headers)
    assert allowed.status_code == 204


def test_remove_access_requires_owner_and_owner_cannot_remove_self():
    owner_headers = _headers("revoke-owner@example.com", "Revoke Owner")
    member_headers = _headers("revoke-member@example.com", "Revoke Member")

    trip = client.post("/api/trips", json={"name": "Revoke Trip", "base_currency_code": "TWD"}, headers=owner_headers).json()
    trip_id = trip["id"]
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)

    access_list = client.get(f"/api/trips/{trip_id}/access", headers=owner_headers).json()
    owner_user_id = next(row["user_id"] for row in access_list if row["role"] == "owner")
    member_user_id = next(row["user_id"] for row in access_list if row["role"] == "editor")

    # Member can't revoke anyone's access (not owner).
    forbidden = client.delete(f"/api/trips/{trip_id}/access/{owner_user_id}", headers=member_headers)
    assert forbidden.status_code == 403

    # Owner can't remove themselves.
    self_removal = client.delete(f"/api/trips/{trip_id}/access/{owner_user_id}", headers=owner_headers)
    assert self_removal.status_code == 400

    # Owner CAN remove the member.
    removed = client.delete(f"/api/trips/{trip_id}/access/{member_user_id}", headers=owner_headers)
    assert removed.status_code == 204

    # The removed member now has no access at all.
    blocked = client.get(f"/api/trips/{trip_id}", headers=member_headers)
    assert blocked.status_code == 403


# ---------- core security guarantee: cross-trip access is blocked everywhere ----------

def test_uninvited_user_is_blocked_from_every_kind_of_endpoint_on_someone_elses_trip():
    """The single most important guarantee of this whole round: user B, who
    was never invited to user A's trip, gets 403'd on every category of
    trip-scoped endpoint — not just the trip resource itself, but every
    sub-resource router too (members/currencies/categories/payment-methods/
    expenses/settlement)."""
    a_headers = _headers("cross-trip-a@example.com", "Cross Trip A")
    b_headers = _headers("cross-trip-b@example.com", "Cross Trip B")

    trip = client.post("/api/trips", json={"name": "A Private Trip", "base_currency_code": "TWD"}, headers=a_headers).json()
    trip_id = trip["id"]
    base_currency_id = next(c["id"] for c in trip["currencies"] if c["is_base"])
    member = client.post(f"/api/trips/{trip_id}/members", json={"name": "A Member"}, headers=a_headers).json()
    category = client.post(f"/api/trips/{trip_id}/categories", json={"name": "餐飲"}, headers=a_headers).json()
    pm = client.post(f"/api/trips/{trip_id}/payment-methods", json={"name": "現金"}, headers=a_headers).json()
    expense = client.post(
        f"/api/trips/{trip_id}/expenses",
        json={
            "date": "2026-08-13",
            "name": "A's private expense",
            "amount": 500.0,
            "currency_id": base_currency_id,
            "payer_id": member["id"],
            "needs_split": False,
            "shares": [],
            "type": "expense",
        },
        headers=a_headers,
    ).json()

    blocked_requests = [
        ("GET", f"/api/trips/{trip_id}"),
        ("PUT", f"/api/trips/{trip_id}"),
        ("DELETE", f"/api/trips/{trip_id}"),
        ("GET", f"/api/trips/{trip_id}/members"),
        ("POST", f"/api/trips/{trip_id}/members"),
        ("GET", f"/api/trips/{trip_id}/currencies"),
        ("POST", f"/api/trips/{trip_id}/currencies"),
        ("GET", f"/api/trips/{trip_id}/categories"),
        ("POST", f"/api/trips/{trip_id}/categories"),
        ("GET", f"/api/trips/{trip_id}/payment-methods"),
        ("POST", f"/api/trips/{trip_id}/payment-methods"),
        ("GET", f"/api/trips/{trip_id}/expenses"),
        ("POST", f"/api/trips/{trip_id}/expenses"),
        ("GET", f"/api/trips/{trip_id}/expenses/{expense['id']}"),
        ("PUT", f"/api/trips/{trip_id}/expenses/{expense['id']}"),
        ("DELETE", f"/api/trips/{trip_id}/expenses/{expense['id']}"),
        ("GET", f"/api/trips/{trip_id}/settlement"),
        ("GET", f"/api/trips/{trip_id}/settlement/by-currency"),
        ("GET", f"/api/trips/{trip_id}/access"),
        ("POST", f"/api/trips/{trip_id}/invite"),
    ]
    for method, path in blocked_requests:
        resp = client.request(method, path, json={} if method in ("PUT", "POST") else None, headers=b_headers)
        assert resp.status_code == 403, f"{method} {path} should be 403 for an uninvited user, got {resp.status_code}: {resp.text}"

    # Sub-resource update/delete-by-id routes (no trip_id in the URL) must
    # also be blocked — check_trip_access is used there instead of
    # require_trip_access (see app/routers/members.py etc.).
    id_scoped_blocked_requests = [
        ("PUT", f"/api/members/{member['id']}"),
        ("DELETE", f"/api/members/{member['id']}"),
        ("PUT", f"/api/categories/{category['id']}"),
        ("DELETE", f"/api/categories/{category['id']}"),
        ("PUT", f"/api/payment-methods/{pm['id']}"),
        ("DELETE", f"/api/payment-methods/{pm['id']}"),
    ]
    for method, path in id_scoped_blocked_requests:
        resp = client.request(method, path, json={"name": "hijacked"} if method == "PUT" else None, headers=b_headers)
        assert resp.status_code == 403, f"{method} {path} should be 403 for an uninvited user, got {resp.status_code}: {resp.text}"

    # And confirm A's data survived untouched (B never actually got through).
    # members[0] is now "Cross Trip A" — create_trip auto-adds the creator as
    # this trip's first Member (see routers/trips.py create_trip and
    # test_create_trip_auto_adds_creator_as_member below) — "A Member" is the
    # one explicitly created above, so it's members[1] here, not members[0].
    still_there = client.get(f"/api/trips/{trip_id}", headers=a_headers)
    assert still_there.status_code == 200
    assert any(m["name"] == "A Member" for m in still_there.json()["members"])


def test_uninvited_user_does_not_see_trip_in_list_trips():
    a_headers = _headers("list-hide-a@example.com", "List Hide A")
    b_headers = _headers("list-hide-b@example.com", "List Hide B")

    trip = client.post("/api/trips", json={"name": "Hidden From B", "base_currency_code": "TWD"}, headers=a_headers).json()

    b_list = client.get("/api/trips", headers=b_headers).json()
    assert all(t["id"] != trip["id"] for t in b_list)


# ---------- create_trip auto-adds creator as a split-Member ----------

def test_create_trip_auto_adds_creator_as_member():
    headers = _headers("automember@example.com", "Auto Member Creator")
    trip = client.post(
        "/api/trips", json={"name": "Auto Member Trip", "base_currency_code": "TWD"}, headers=headers
    ).json()
    assert len(trip["members"]) == 1
    assert trip["members"][0]["name"] == "Auto Member Creator"


# ---------- guest login / link-guest (see app/routers/auth.py) ----------

def test_guest_login_requires_no_authorization_header():
    resp = client.post("/api/auth/guest")
    assert resp.status_code == 201
    body = resp.json()
    assert body["token"]
    assert body["user"]["name"] == "訪客"
    assert body["user"]["email"].startswith("guest-")
    assert body["user"]["email"].endswith("@guest.local")


def test_guest_cannot_create_trip():
    """This round's "訪客也能是完整成員" simplification removes a guest's
    ability to create a brand-new trip at all — a guest identity now only
    ever exists to redeem an invite link's restricted "contributor" access
    (see routers/trips.py create_trip / join_trip). Must be a clear 403 with
    copy telling the guest to log in with Google instead, not a generic
    failure."""
    guest = client.post("/api/auth/guest").json()
    guest_headers = {"Authorization": f"Bearer {guest['token']}"}

    resp = client.post(
        "/api/trips", json={"name": "Guest Trip", "base_currency_code": "TWD"}, headers=guest_headers
    )
    assert resp.status_code == 403
    assert "訪客" in resp.json()["detail"]

    # And no trip was actually created for anyone.
    listed = client.get("/api/trips", headers=guest_headers).json()
    assert all(t["name"] != "Guest Trip" for t in listed)


def test_link_guest_transfers_trip_access_and_deletes_guest_account():
    """A guest joins a trip (via invite — guests can no longer create their
    own trips, see test_guest_cannot_create_trip above), then later logs in
    with a real Google account and links the guest session — the trip must
    show up under the Google account, and the guest User row must be gone
    afterward."""
    trip_owner_headers = _headers("link-transfer-owner@example.com", "Link Transfer Owner")
    trip = client.post(
        "/api/trips", json={"name": "Guest's Trip", "base_currency_code": "TWD"}, headers=trip_owner_headers
    ).json()
    trip_id = trip["id"]
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=trip_owner_headers).json()["invite_code"]

    guest = client.post("/api/auth/guest").json()
    guest_token = guest["token"]
    guest_headers = {"Authorization": f"Bearer {guest_token}"}
    join_resp = client.post("/api/trips/join", json={"invite_code": invite_code}, headers=guest_headers)
    assert join_resp.status_code == 200

    google_headers = _headers("linked-google-user@example.com", "Linked Google User")
    # Before linking, the Google account can't see the guest's trip at all.
    before = client.get("/api/trips", headers=google_headers).json()
    assert all(t["id"] != trip_id for t in before)

    link_resp = client.post(
        "/api/auth/link-guest", json={"guest_token": guest_token}, headers=google_headers
    )
    assert link_resp.status_code == 200
    merged_trips = link_resp.json()
    assert any(t["id"] == trip_id for t in merged_trips)

    # The Google account can now see it via the normal list_trips endpoint
    # too, not just the link-guest response.
    after = client.get("/api/trips", headers=google_headers).json()
    assert any(t["id"] == trip_id for t in after)

    # The guest User row was deleted (not just its TripAccess) — assert the
    # DB has zero rows for that synthetic email; re-hitting a protected
    # endpoint with the now-orphaned guest token would just upsert a *new*
    # row for that same email (get_current_user's upsert-on-first-request
    # behavior), which would defeat this assertion.
    db = TestingSessionLocal()
    try:
        guest_email = jwt.decode(guest_token, auth.APP_JWT_SECRET, algorithms=[auth.JWT_ALGORITHM])["email"]
        assert db.query(models.User).filter(models.User.email == guest_email).count() == 0
    finally:
        db.close()


def test_link_guest_rejects_invalid_token():
    google_headers = _headers("link-invalid-token@example.com", "Link Invalid Token")
    resp = client.post(
        "/api/auth/link-guest", json={"guest_token": "not-a-real-jwt"}, headers=google_headers
    )
    assert resp.status_code == 400


def test_link_guest_rejects_already_linked_guest_token():
    """Not idempotent by design — a guest's data can only be merged into one
    real account, once. A second link-guest call with the same (now-stale)
    guest_token must fail cleanly instead of 500ing or silently no-op'ing."""
    guest = client.post("/api/auth/guest").json()
    guest_token = guest["token"]

    google_headers = _headers("link-twice-a@example.com", "Link Twice A")
    first = client.post("/api/auth/link-guest", json={"guest_token": guest_token}, headers=google_headers)
    assert first.status_code == 200

    google_headers_2 = _headers("link-twice-b@example.com", "Link Twice B")
    second = client.post(
        "/api/auth/link-guest", json={"guest_token": guest_token}, headers=google_headers_2
    )
    assert second.status_code == 400


def test_join_trip_auto_links_member_for_joining_user():
    """This round's Member<->User linking (models.Member.user_id): redeeming
    an invite code must not just grant TripAccess — it should also either
    link an existing same-user Member or auto-create one, so the joiner is
    immediately a split participant without the owner adding them by hand.
    """
    owner_headers = _headers("automember-join-owner@example.com", "Automember Join Owner")
    member_headers = _headers("automember-join-member@example.com", "Automember Join Member")

    trip = client.post(
        "/api/trips", json={"name": "Automember Join Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]

    join_resp = client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)
    assert join_resp.status_code == 200

    detail = client.get(f"/api/trips/{trip_id}", headers=owner_headers).json()
    member_users = client.get(f"/api/trips/{trip_id}/access", headers=owner_headers).json()
    joined_user_id = next(row["user_id"] for row in member_users if row["email"] == "automember-join-member@example.com")

    linked_members = [m for m in detail["members"] if m["user_id"] == joined_user_id]
    assert len(linked_members) == 1
    assert linked_members[0]["name"] == "Automember Join Member"

    # Repeat join (idempotent invite redemption) must not create a second
    # Member row for the same already-linked user.
    join_again = client.post("/api/trips/join", json={"invite_code": invite_code}, headers=member_headers)
    assert join_again.status_code == 200
    detail2 = client.get(f"/api/trips/{trip_id}", headers=owner_headers).json()
    assert len([m for m in detail2["members"] if m["user_id"] == joined_user_id]) == 1


def test_create_trip_links_creator_member_user_id():
    headers = _headers("create-links-member@example.com", "Create Links Member")
    trip = client.post(
        "/api/trips", json={"name": "Create Links Trip", "base_currency_code": "TWD"}, headers=headers
    ).json()
    access_list = client.get(f"/api/trips/{trip['id']}/access", headers=headers).json()
    creator_user_id = next(row["user_id"] for row in access_list if row["role"] == "owner")
    assert trip["members"][0]["user_id"] == creator_user_id


# NOTE: test_link_guest_repoints_member_user_id_to_real_account (previously
# here) was REMOVED by this round's "訪客也能是完整成員" simplification: its
# entire premise was a guest creating their own trip (auto-linked as that
# trip's first Member) and link-guest repointing that Member.user_id to the
# real Google account. Guests can no longer create trips at all (see
# test_guest_cannot_create_trip above), and even a guest who joins an
# existing trip via invite is never linked to (or causes the creation of) a
# Member row anymore (see join_trip's is_guest branch / models.TripAccess's
# "contributor" role docstring) — there is no longer any Member.user_id
# pointing at a guest for link-guest to repoint. link-guest's actual
# remaining job (reassigning TripAccess rows, deleting the guest User row)
# is still covered by test_link_guest_transfers_trip_access_and_deletes_guest_account
# above.


def test_guest_login_accepts_custom_name():
    resp = client.post("/api/auth/guest", json={"name": "  小明  "})
    assert resp.status_code == 201
    assert resp.json()["user"]["name"] == "小明"


def test_guest_login_blank_name_falls_back_to_default():
    resp = client.post("/api/auth/guest", json={"name": "   "})
    assert resp.status_code == 201
    assert resp.json()["user"]["name"] == "訪客"


def test_guest_login_with_no_body_still_works():
    resp = client.post("/api/auth/guest")
    assert resp.status_code == 201
    assert resp.json()["user"]["name"] == "訪客"


def test_update_me_renames_current_user():
    headers = _headers("rename-me@example.com", "Original Name")
    resp = client.put("/api/auth/me", json={"name": "New Name"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"

    # Persisted: a follow-up request (still using the same token, whose own
    # embedded `name` claim is now stale) reflects the DB's updated name via
    # get_current_user's lookup-by-email.
    access_check = client.get("/api/trips", headers=headers)
    assert access_check.status_code == 200


def test_update_me_rejects_blank_name():
    headers = _headers("rename-blank@example.com", "Has A Name")
    resp = client.put("/api/auth/me", json={"name": "   "}, headers=headers)
    assert resp.status_code == 400


# ---------- join_trip auto-matches an existing unlinked same-name Member ----------

def test_join_trip_links_existing_unlinked_member_with_exact_matching_name_instead_of_duplicating():
    """The core fix for "owner manually adds 小明, then the real 小明 later
    joins via invite link": joining should link the existing unlinked Member
    (exact, trimmed, case-insensitive name match) instead of creating a
    second Member row for the same person."""
    owner_headers = _headers("namejoin-owner@example.com", "Namejoin Owner")
    trip = client.post(
        "/api/trips", json={"name": "Namejoin Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]

    # Owner manually adds an unlinked member named "  Xiao Ming  " (extra
    # whitespace on purpose, to prove trimming applies on both sides).
    manual_member = client.post(
        f"/api/trips/{trip_id}/members", json={"name": "Xiao Ming"}, headers=owner_headers
    ).json()

    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]
    # The real "xiao ming" joins with a differently-cased/whitespaced name.
    joiner_headers = _headers("real-xiaoming@example.com", "  xiao ming  ")
    join_resp = client.post("/api/trips/join", json={"invite_code": invite_code}, headers=joiner_headers)
    assert join_resp.status_code == 200

    detail = client.get(f"/api/trips/{trip_id}", headers=owner_headers).json()
    # Still exactly one member total besides the owner's own auto-added
    # member — the manual one got LINKED, not duplicated.
    non_owner_members = [m for m in detail["members"] if m["id"] != trip["members"][0]["id"]]
    assert len(non_owner_members) == 1
    assert non_owner_members[0]["id"] == manual_member["id"]
    assert non_owner_members[0]["user_id"] is not None


def test_join_trip_does_not_link_a_name_that_belongs_to_a_different_already_linked_member():
    """An exact name match on a Member that's already linked to someone else
    must NOT be stolen — a brand-new Member should be created instead."""
    owner_headers = _headers("namejoin-b-owner@example.com", "Namejoin B Owner")
    trip = client.post(
        "/api/trips", json={"name": "Namejoin B Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]

    # First joiner, named "Same Name", gets linked as a new Member.
    first_headers = _headers("namejoin-b-first@example.com", "Same Name")
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=first_headers)

    # Second joiner, coincidentally also named "Same Name", must NOT get
    # linked onto the first joiner's already-linked Member.
    second_headers = _headers("namejoin-b-second@example.com", "Same Name")
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=second_headers)

    detail = client.get(f"/api/trips/{trip_id}", headers=owner_headers).json()
    same_name_members = [m for m in detail["members"] if m["name"] == "Same Name"]
    assert len(same_name_members) == 2
    assert len({m["user_id"] for m in same_name_members}) == 2


def test_link_guest_skips_duplicate_trip_access_without_error():
    """If the now-Google-authenticated user already independently has access
    to a trip the guest also had access to (e.g. invited under both
    identities), linking must not violate TripAccess's (trip_id, user_id)
    UNIQUE constraint — the guest's redundant row is just dropped instead."""
    owner_headers = _headers("dup-owner@example.com", "Dup Owner")
    trip = client.post(
        "/api/trips", json={"name": "Dup Access Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]

    guest = client.post("/api/auth/guest").json()
    guest_token = guest["token"]
    guest_headers = {"Authorization": f"Bearer {guest_token}"}
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=guest_headers)

    google_headers = _headers("dup-google@example.com", "Dup Google")
    # The Google user independently joins the same trip too, BEFORE linking.
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=google_headers)

    link_resp = client.post(
        "/api/auth/link-guest", json={"guest_token": guest_token}, headers=google_headers
    )
    assert link_resp.status_code == 200
    merged = link_resp.json()
    # No duplicate entries for the same trip in the response.
    assert len([t for t in merged if t["id"] == trip_id]) == 1

    access_list = client.get(f"/api/trips/{trip_id}/access", headers=owner_headers).json()
    google_rows = [row for row in access_list if row["email"] == "dup-google@example.com"]
    assert len(google_rows) == 1


# NOTE: guest recovery code tests (test_guest_login_returns_a_recovery_code,
# test_guest_recover_reissues_token_for_same_guest_identity,
# test_guest_recover_rejects_unknown_code,
# test_guest_recover_can_reach_trips_created_before_recovery) were REMOVED by
# this round's "訪客不該有任何帳號感" simplification, which deleted the whole
# guest-recovery mechanism (POST /api/auth/guest/recover, GuestLoginOut.
# recovery_code, models.User.recovery_code generation) — see routers/auth.py
# guest_login's docstring / models.User.recovery_code's docstring for what's
# left of it (a retired, always-NULL-for-new-rows column, kept per this
# project's "舊欄位保留閒置" convention rather than deleted outright).


# ---------- join preview + claim_member_id (see routers/trips.py join_preview / join_trip) ----------

def test_join_preview_lists_unlinked_members_and_trip_name():
    owner_headers = _headers("preview-owner@example.com", "Preview Owner")
    trip = client.post(
        "/api/trips", json={"name": "Preview Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]
    unlinked = client.post(f"/api/trips/{trip_id}/members", json={"name": "小華"}, headers=owner_headers).json()
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]

    preview = client.get(f"/api/trips/join/preview?code={invite_code}")
    assert preview.status_code == 200
    body = preview.json()
    assert body["trip_name"] == "Preview Trip"
    unlinked_ids = [m["id"] for m in body["unlinked_members"]]
    # The owner's own auto-added member is already linked (user_id set), so
    # it must NOT show up here — only the manually-added, still-unlinked "小華".
    assert unlinked_ids == [unlinked["id"]]


def test_join_preview_rejects_invalid_code():
    resp = client.get("/api/trips/join/preview?code=not-a-real-code")
    assert resp.status_code == 404


def test_join_trip_with_claim_member_id_links_the_chosen_member_not_a_new_one():
    """claim_member_id is a Google-joiner-only feature after this round's
    "訪客也能是完整成員" simplification (a guest ignores it entirely — see
    test_guest_join_trip_ignores_claim_member_id_and_never_touches_members
    below) — exercised here with a real (non-guest) identity instead of the
    guest headers this test used before."""
    owner_headers = _headers("claim-owner@example.com", "Claim Owner")
    trip = client.post(
        "/api/trips", json={"name": "Claim Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]
    unlinked = client.post(f"/api/trips/{trip_id}/members", json={"name": "小明"}, headers=owner_headers).json()
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]

    joiner_headers = _headers("claim-joiner@example.com", "Someone Else")
    join_resp = client.post(
        "/api/trips/join",
        json={"invite_code": invite_code, "claim_member_id": unlinked["id"]},
        headers=joiner_headers,
    )
    assert join_resp.status_code == 200
    detail = join_resp.json()
    # Still exactly the owner's member + the one claimed member — no third,
    # freshly-created Member row for the joiner.
    assert len(detail["members"]) == 2
    claimed = next(m for m in detail["members"] if m["id"] == unlinked["id"])
    access_list = client.get(f"/api/trips/{trip_id}/access", headers=owner_headers).json()
    joiner_user_id = next(row["user_id"] for row in access_list if row["email"] == "claim-joiner@example.com")
    assert claimed["user_id"] == joiner_user_id


def test_join_trip_claim_member_id_rejects_member_from_a_different_trip():
    owner_headers = _headers("claim-cross-owner@example.com", "Claim Cross Owner")
    trip_a = client.post(
        "/api/trips", json={"name": "Claim Trip A", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_b = client.post(
        "/api/trips", json={"name": "Claim Trip B", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    other_trip_member_id = trip_b["members"][0]["id"]
    invite_code_a = client.post(f"/api/trips/{trip_a['id']}/invite", headers=owner_headers).json()["invite_code"]

    joiner_headers = _headers("claim-cross-joiner@example.com", "Claim Cross Joiner")
    resp = client.post(
        "/api/trips/join",
        json={"invite_code": invite_code_a, "claim_member_id": other_trip_member_id},
        headers=joiner_headers,
    )
    assert resp.status_code == 404


def test_join_trip_claim_member_id_rejects_already_linked_member():
    owner_headers = _headers("claim-linked-owner@example.com", "Claim Linked Owner")
    trip = client.post(
        "/api/trips", json={"name": "Claim Linked Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]
    already_linked_member_id = trip["members"][0]["id"]  # the owner's own auto-linked member
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]

    joiner_headers = _headers("claim-linked-joiner@example.com", "Claim Linked Joiner")
    resp = client.post(
        "/api/trips/join",
        json={"invite_code": invite_code, "claim_member_id": already_linked_member_id},
        headers=joiner_headers,
    )
    assert resp.status_code == 400


def test_guest_join_trip_ignores_claim_member_id_and_never_touches_members():
    """The core rule this round's "訪客也能是完整成員" simplification adds to
    join_trip: a guest ALWAYS lands as "contributor" and is NEVER linked to
    (or causes the creation of) a Member row — claim_member_id is silently
    ignored for a guest joiner, even when it references a real, claimable
    unlinked member of this trip."""
    owner_headers = _headers("guest-ignore-claim-owner@example.com", "Guest Ignore Claim Owner")
    trip = client.post(
        "/api/trips", json={"name": "Guest Ignore Claim Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]
    unlinked = client.post(f"/api/trips/{trip_id}/members", json={"name": "小美"}, headers=owner_headers).json()
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]

    guest = client.post("/api/auth/guest", json={"name": "小美"}).json()
    guest_headers = {"Authorization": f"Bearer {guest['token']}"}
    join_resp = client.post(
        "/api/trips/join",
        json={"invite_code": invite_code, "claim_member_id": unlinked["id"]},
        headers=guest_headers,
    )
    assert join_resp.status_code == 200
    detail = join_resp.json()
    # Still exactly the owner's member + the unclaimed "小美" — no Member got
    # linked to the guest despite claim_member_id AND a matching display name.
    assert len(detail["members"]) == 2
    still_unlinked = next(m for m in detail["members"] if m["id"] == unlinked["id"])
    assert still_unlinked["user_id"] is None
    assert all(m["user_id"] != guest["user"]["id"] for m in detail["members"])

    access_list = client.get(f"/api/trips/{trip_id}/access", headers=owner_headers).json()
    guest_row = next(row for row in access_list if row["user_id"] == guest["user"]["id"])
    assert guest_row["role"] == "contributor"


# ---------- per-member "初始換匯" (see models.Member docstring, routers/members.py) ----------

def test_update_member_sets_and_returns_initial_exchange_fields():
    owner_headers = _headers("exchange-owner@example.com", "Exchange Owner")
    trip = client.post(
        "/api/trips", json={"name": "Exchange Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    member_id = trip["members"][0]["id"]

    resp = client.put(
        f"/api/members/{member_id}",
        json={
            "name": "Exchange Owner",
            "initial_exchange_from_currency": "TWD",
            "initial_exchange_from_amount": 20000,
            "initial_exchange_to_currency": "JPY",
            "initial_exchange_to_amount": 90000,
            "initial_exchange_rate": 0.22,
        },
        headers=owner_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["initial_exchange_from_currency"] == "TWD"
    assert body["initial_exchange_from_amount"] == 20000
    assert body["initial_exchange_to_currency"] == "JPY"
    assert body["initial_exchange_to_amount"] == 90000
    assert body["initial_exchange_rate"] == 0.22

    # A plain rename (only `name` sent) must NOT clobber the exchange record
    # just saved above.
    rename_resp = client.put(
        f"/api/members/{member_id}", json={"name": "Renamed Owner"}, headers=owner_headers
    )
    assert rename_resp.status_code == 200
    assert rename_resp.json()["initial_exchange_to_amount"] == 90000


# ---------- "只有本人能管理自己的換匯" (this round's exchange-ownership rule,
# see routers/members.py update_member) ----------

def test_member_exchange_self_edit_by_linked_account_succeeds():
    """The account a linked Member's user_id actually points at may always
    edit that Member's own exchange fields — exercised here via a second
    user who joins the trip and is auto-linked to their own Member (see
    routers/trips.py join_trip), editing their own record."""
    owner_headers = _headers("exchange-self-owner@example.com", "Exchange Self Owner")
    trip = client.post(
        "/api/trips", json={"name": "Exchange Self Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]

    joiner_headers = _headers("exchange-self-joiner@example.com", "Exchange Self Joiner")
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=joiner_headers)
    detail = client.get(f"/api/trips/{trip_id}", headers=owner_headers).json()
    joiner_member = next(m for m in detail["members"] if m["name"] == "Exchange Self Joiner")

    resp = client.put(
        f"/api/members/{joiner_member['id']}",
        json={
            "name": joiner_member["name"],
            "initial_exchange_from_currency": "TWD",
            "initial_exchange_from_amount": 5000,
            "initial_exchange_to_currency": "JPY",
            "initial_exchange_to_amount": 22000,
            "initial_exchange_rate": 0.227,
        },
        headers=joiner_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["initial_exchange_to_amount"] == 22000


def test_member_exchange_edit_by_someone_else_including_owner_is_forbidden_for_linked_member():
    """Even the trip owner may not edit ANOTHER linked account's exchange
    fields — this is the core rule this round adds: "初始換匯" is a
    self-managed record once a Member is linked to a real login."""
    owner_headers = _headers("exchange-other-owner@example.com", "Exchange Other Owner")
    trip = client.post(
        "/api/trips", json={"name": "Exchange Other Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]
    invite_code = client.post(f"/api/trips/{trip_id}/invite", headers=owner_headers).json()["invite_code"]

    joiner_headers = _headers("exchange-other-joiner@example.com", "Exchange Other Joiner")
    client.post("/api/trips/join", json={"invite_code": invite_code}, headers=joiner_headers)
    detail = client.get(f"/api/trips/{trip_id}", headers=owner_headers).json()
    joiner_member = next(m for m in detail["members"] if m["name"] == "Exchange Other Joiner")

    # Owner (has full edit access to everything else on the trip) still gets
    # 403'd for touching the joiner's own exchange fields.
    resp = client.put(
        f"/api/members/{joiner_member['id']}",
        json={
            "name": joiner_member["name"],
            "initial_exchange_from_currency": "TWD",
            "initial_exchange_from_amount": 1000,
            "initial_exchange_to_currency": "USD",
            "initial_exchange_to_amount": 32,
            "initial_exchange_rate": 31.5,
        },
        headers=owner_headers,
    )
    assert resp.status_code == 403
    assert "本人" in resp.json()["detail"]

    # A plain rename of the SAME member by the owner is still allowed — the
    # new rule only covers the five initial_exchange_* fields, not renaming.
    rename_resp = client.put(
        f"/api/members/{joiner_member['id']}", json={"name": "Renamed By Owner"}, headers=owner_headers
    )
    assert rename_resp.status_code == 200
    assert rename_resp.json()["name"] == "Renamed By Owner"


def test_member_exchange_edit_by_owner_is_forbidden_for_unlinked_member():
    """A Member with no linked account (`user_id` is None — just a typed-in
    name, nobody can log in as "them") used to let any editor/owner fill in
    its exchange record on their behalf; that exception is gone this round.
    With no linked account, NOBODY (not even the trip owner) may write the
    exchange fields until the member links an account."""
    owner_headers = _headers("exchange-unlinked-owner@example.com", "Exchange Unlinked Owner")
    trip = client.post(
        "/api/trips", json={"name": "Exchange Unlinked Trip", "base_currency_code": "TWD"}, headers=owner_headers
    ).json()
    trip_id = trip["id"]
    unlinked_member = client.post(
        f"/api/trips/{trip_id}/members", json={"name": "純打字成員"}, headers=owner_headers
    ).json()
    assert unlinked_member["user_id"] is None

    resp = client.put(
        f"/api/members/{unlinked_member['id']}",
        json={
            "name": unlinked_member["name"],
            "initial_exchange_from_currency": "TWD",
            "initial_exchange_from_amount": 2000,
            "initial_exchange_to_currency": "KRW",
            "initial_exchange_to_amount": 80000,
            "initial_exchange_rate": 0.025,
        },
        headers=owner_headers,
    )
    assert resp.status_code == 403
    assert "連結帳號" in resp.json()["detail"]

    # A plain rename (only `name` sent, no exchange fields) is NOT covered by
    # this rule and stays governed purely by check_edit_access — an
    # owner/editor may still rename an unlinked member.
    rename_resp = client.put(
        f"/api/members/{unlinked_member['id']}",
        json={"name": "改名後的純打字成員"},
        headers=owner_headers,
    )
    assert rename_resp.status_code == 200
    assert rename_resp.json()["name"] == "改名後的純打字成員"
