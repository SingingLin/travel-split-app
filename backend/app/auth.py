"""Custom-signed JWT auth for TravelSplit's own API calls.

This project's frontend will (next round) get a real Google login via
NextAuth, but the *API calls from frontend to this backend* don't use
NextAuth's session directly — instead the frontend attaches a JWT this
backend itself signs/verifies, carried as `Authorization: Bearer <token>` on
every request. That's what this module implements: signing (for next round's
login flow), verifying (used on every protected request today), and the two
FastAPI dependencies routers use to enforce "must be logged in" /
"must have access to this specific trip".

APP_JWT_SECRET vs NEXTAUTH_SECRET
----------------------------------
APP_JWT_SECRET (below) is a *different* secret from NextAuth's own internal
NEXTAUTH_SECRET. NEXTAUTH_SECRET only ever lives on the frontend and encrypts
NextAuth's own session cookie/JWT — this backend never sees it and never
needs to. APP_JWT_SECRET is this backend's own signing key for the tokens
the frontend forwards to *this* API. Never reuse one for the other.

SECURITY — read before deploying
---------------------------------
The fallback default below ("dev-insecure-secret-change-in-production") is a
well-known, publicly-visible placeholder. It exists purely so local
development and `pytest` work with zero setup — nobody should have to export
an env var just to run the test suite. Production (Vercel/Render env
settings) MUST override APP_JWT_SECRET with a real, random secret. Deploying
with the default value would let anyone forge a valid login token for any
user (they'd just need to read this file, which is public source).
"""
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app import models
from app.database import get_db

APP_JWT_SECRET = os.environ.get("APP_JWT_SECRET", "dev-insecure-secret-change-in-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7


def create_access_token(user: "models.User") -> str:
    """Sign a 7-day HS256 JWT for `user`.

    Not called anywhere yet in this round — issuing tokens is next round's
    job, once the frontend actually does a real Google login and needs to
    hand this backend something to verify on every subsequent request.
    Written and tested now so it's ready to plug in then. No refresh-token
    mechanism: once a token expires, the frontend just sends the user
    through Google login again to get a fresh one.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "name": user.name,
        "iat": now,
        "exp": now + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, APP_JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Verify signature + expiry and return the decoded payload dict.

    Raises jwt.ExpiredSignatureError (token past its `exp`) or
    jwt.InvalidTokenError (bad signature / malformed token) — both are
    subclasses of jwt.PyJWTError, which get_current_user below catches and
    turns into a 401.
    """
    return jwt.decode(token, APP_JWT_SECRET, algorithms=[JWT_ALGORITHM])


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> models.User:
    """Resolve the calling user from the `Authorization: Bearer <token>`
    header.

    Upsert-on-first-request: this backend may not have a User row yet the
    very first time a given email shows up (this round assumes the frontend
    has already "logged the user in" and just hands us a signed JWT — it
    doesn't guarantee a matching User row exists here yet), so a valid token
    for an email with no existing User creates one on the spot using the
    token's `email`/`name` claims, then proceeds as normal.

    Missing header, malformed header, expired token, or bad signature all
    result in a 401 with a message telling the user to log back in — this
    function never distinguishes those cases in the response (no reason to
    hand an attacker more detail than necessary).
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="請重新登入")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="請重新登入")

    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登入已過期或無效，請重新登入")

    email = payload.get("email")
    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="請重新登入")

    # Google avatar URL, if this token carries one — see frontend/auth.ts's
    # jwt() callback, which only sets this claim on a real Google sign-in
    # (straight from `user.image`, i.e. session.user.image); a guest token
    # (routers/auth.py guest_login's create_access_token call)
    # never includes it, so `avatar_url` stays None for every guest here.
    avatar_url = payload.get("avatar_url") or None

    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        user = models.User(email=email, name=payload.get("name") or email, avatar_url=avatar_url)
        db.add(user)
        db.commit()
        db.refresh(user)
    elif avatar_url and user.avatar_url != avatar_url:
        # Keep the stored avatar in sync with whatever Google most recently
        # handed back (it can change, or simply wasn't available/stored the
        # first time this User row was created) — only ever overwrites with
        # a real value from this token, never clears an existing avatar_url
        # just because a particular request's token happens not to carry one.
        user.avatar_url = avatar_url
        db.commit()
        db.refresh(user)
    return user


def check_trip_access(db: Session, user: models.User, trip_id: int) -> models.TripAccess:
    """Non-dependency version of require_trip_access, for routes where
    `trip_id` isn't itself a path parameter — e.g. PUT /api/members/{member_id}
    only has `member_id` in the URL. Those routes look the resource up first
    to learn its trip_id, then call this directly to enforce access before
    reading/mutating it. require_trip_access below is just this wrapped as a
    FastAPI dependency for the (more common) case where trip_id IS a path
    parameter.
    """
    access = (
        db.query(models.TripAccess)
        .filter(models.TripAccess.trip_id == trip_id, models.TripAccess.user_id == user.id)
        .first()
    )
    if not access:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="你沒有這趟行程的存取權限")
    return access


def require_trip_access(
    trip_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.TripAccess:
    """FastAPI dependency for routes that already have `trip_id` as a path
    parameter (FastAPI binds this function's `trip_id` argument to that same
    path parameter automatically). Returns the caller's TripAccess row so the
    route can check `.role == "owner"` for owner-only operations (e.g.
    deleting the trip, revoking someone else's access); raises 403 if the
    caller has no access to this trip at all.

    This only checks that SOME access exists — it does NOT distinguish
    "viewer" from "editor"/"owner". Use this (unchanged) for every read-only
    (GET) route; use require_edit_access below for any route that writes
    data, so a "viewer"-role caller is rejected before ever reaching the
    handler.
    """
    return check_trip_access(db, current_user, trip_id)


def check_edit_access(db: Session, user: models.User, trip_id: int) -> models.TripAccess:
    """Non-dependency version of require_edit_access, for routes where
    `trip_id` isn't itself a path parameter (see check_trip_access's
    docstring above for the same pattern) — e.g. PUT /api/members/{member_id}
    only has `member_id` in the URL, so it looks the member up first to learn
    its trip_id, then calls this to enforce edit access before mutating it.

    Resolves access via check_trip_access first (so "no access at all" still
    correctly 403s the same way it always did), then additionally rejects
    any role other than "owner"/"editor" — both "viewer" (the original
    "擁有者／可編輯／唯讀" simplification, see models.TripAccess's docstring)
    and "contributor" (the guest-mode restricted role added this round: a
    guest may create new expenses via require_expense_create_access below,
    but every other write — including editing/deleting an expense — goes
    through this same require_edit_access boundary and is rejected exactly
    like a viewer would be). Every GET still only requires
    require_trip_access/check_trip_access, unaffected by this function.
    """
    access = check_trip_access(db, user, trip_id)
    if access.role not in ("owner", "editor"):
        detail = "你是唯讀權限，無法編輯這趟行程" if access.role == "viewer" else "訪客身分無法編輯這趟行程的資料"
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    return access


def require_edit_access(
    trip_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.TripAccess:
    """FastAPI dependency for routes that already have `trip_id` as a path
    parameter AND write data (POST/PUT/DELETE that create/edit/delete a
    resource) — the require_edit_access counterpart to require_trip_access
    above. Every write-route in this app should depend on this instead of
    require_trip_access (GET routes keep require_trip_access unchanged),
    with exactly one carve-out: POST .../expenses (creating a NEW expense)
    uses require_expense_create_access instead, so a "contributor" (guest)
    can do that one specific write — everything else, including editing or
    deleting an existing expense, stays on this dependency and rejects
    "viewer" and "contributor" alike. Owner-only operations additionally
    check `.role == "owner"` on the returned TripAccess themselves, same as
    before this dependency existed.
    """
    return check_edit_access(db, current_user, trip_id)


def check_expense_create_access(db: Session, user: models.User, trip_id: int) -> models.TripAccess:
    """Non-dependency version of require_expense_create_access — see that
    dependency's docstring. No current call site needs this (every "create a
    new expense" route has `trip_id` as a path parameter), but provided for
    symmetry with check_trip_access/check_edit_access in case a future
    sub-resource route ever needs it.
    """
    access = check_trip_access(db, user, trip_id)
    if access.role not in ("owner", "editor", "contributor"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="你是唯讀權限，無法新增支出")
    return access


def require_expense_create_access(
    trip_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.TripAccess:
    """FastAPI dependency for the ONE endpoint a "contributor" (guest) may
    write to: POST .../expenses (creating a brand-new expense). Deliberately
    NOT used for anything else — editing/deleting an expense, or writing to
    any other resource, still goes through require_edit_access above, which
    rejects "contributor" exactly like "viewer".

    This is the whole reason "contributor" exists as a role distinct from
    "viewer": a guest who was handed an invite link is there specifically to
    help enter a purchase's numbers into the system (see this round's task
    spec — "訪客的存在意義只有一個：幫忙把一筆支出的數字打進系統"), so this
    dependency allows "owner"/"editor"/"contributor" through and rejects only
    "viewer".
    """
    return check_expense_create_access(db, current_user, trip_id)
