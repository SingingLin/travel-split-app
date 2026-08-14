"""Guest-mode login and guest->Google account linking.

Two endpoints, both deliberately outside the "must already have a
TripAccess row somewhere" world app/auth.py's require_trip_access enforces:

- POST /api/auth/guest: no login required at all — the whole point is to
  let a brand-new visitor start using the app (redeem an invite link, add
  expenses) with zero signup friction. Issues a normal signed JWT (same
  create_access_token this backend already uses for Google logins), just
  for a synthetic "guest" User row instead of a real Google identity.
- POST /api/auth/link-guest: requires being logged in as usual
  (get_current_user) — called right after a guest successfully completes a
  real Google login, to fold everything the guest could see into the
  now-authenticated account and discard the guest identity. See
  link_guest's docstring below for the merge semantics.

This round's "訪客不該有任何帳號感" simplification removed guest recovery
entirely (there used to be a third endpoint here, POST /api/auth/guest/
recover, plus a "找回代碼" the frontend showed right after guest creation) —
a guest identity is now purely disposable: it lives only as long as this
browser keeps the token from POST /api/auth/guest in localStorage, with no
way to reconstruct it elsewhere on purpose. See models.User.recovery_code's
docstring for what's left of the old mechanism (a retired, always-NULL-for-
new-rows column, not deleted outright per this project's convention).

Frontend side: frontend/lib/authToken.ts stores the guest JWT in
localStorage (never a cookie — see that file's docstring) under the key
"guest_token", and frontend/app/join/[code]/page.tsx / a persistent "訪客
模式" banner are what call these endpoints. See frontend/middleware.ts for
how a guest's browser is recognized as "has some kind of session" without
NextAuth ever being involved.
"""
import uuid

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import create_access_token, decode_access_token, get_current_user
from app.database import get_db
from app.routers.trips import trip_summaries_for_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/guest", response_model=schemas.GuestLoginOut, status_code=201)
def guest_login(payload: schemas.GuestLoginIn | None = None, db: Session = Depends(get_db)):
    """Create a brand-new guest User and hand back a signed JWT for it —
    no Authorization header required to call this at all.

    users.email is NOT NULL UNIQUE (see models.User), so a guest can't just
    get `email=None` — instead each guest gets its own synthetic,
    guaranteed-unique placeholder ("guest-<uuid4>@guest.local") that will
    never collide with a real Google email or another guest's placeholder.
    The returned token is otherwise indistinguishable in shape from a real
    Google-login token (same create_access_token, same claims) — every
    other endpoint in this app treats a guest exactly like any other User
    (with the narrower "contributor" TripAccess role join_trip's is_guest
    branch grants them), right up until (optionally) POST /api/auth/
    link-guest folds that guest identity into a real one.

    Deliberately does NOT generate/store a recovery code anymore (see
    models.User.recovery_code's docstring — this round's "訪客不該有任何帳號
    感" simplification removed that entirely): a guest identity now lives
    only as long as this browser keeps the returned token, with no way to
    reconstruct it elsewhere on purpose — there is no "log back in as this
    same guest" concept at all.

    `payload.name` (see schemas.GuestLoginIn) still lets a caller pick their
    own display name instead of always starting as "訪客", kept purely for
    backend flexibility/future callers — optional and defaults to "訪客"
    whenever it's omitted, an empty body is sent, or the name is blank/
    whitespace-only after trimming, so this endpoint's "zero-friction, no
    body required" contract never breaks. The current frontend caller
    (app/join/[code]/page.tsx's guest-join flow) never sends `name` at all
    anymore — every guest is just "訪客", no naming step in that flow.
    """
    guest_email = f"guest-{uuid.uuid4()}@guest.local"
    name = (payload.name.strip() if payload and payload.name else "") or "訪客"
    user = models.User(email=guest_email, name=name, is_guest=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(user)
    return schemas.GuestLoginOut(token=token, user=user)


@router.put("/me", response_model=schemas.UserOut)
def update_me(
    payload: schemas.UserUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rename the calling user's own account. Any logged-in user (guest or
    Google) may call this for themselves — see schemas.UserUpdate's docstring
    for why this isn't restricted to guests at the backend level even though
    the frontend only surfaces a rename UI for guests (components/
    UserMenu.tsx). Note: this only updates the `users.name` column read by
    every *future* request's get_current_user upsert-and-reuse lookup and by
    fresh JOINs (e.g. GET /api/trips/{id}/access) — it deliberately does NOT
    also rewrite Member.name rows this user is linked to (see models.Member.
    user_id), since those are independently editable "split participant"
    names the trip owner may have customized (e.g. a nickname) and
    silently overwriting them on every login-identity rename would be
    surprising, not helpful.
    """
    trimmed = payload.name.strip()
    if not trimmed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="名稱不能為空")
    current_user.name = trimmed
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/link-guest", response_model=list[schemas.TripSummaryOut])
def link_guest(
    payload: schemas.LinkGuestIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Merge a guest account's trip access into the caller's (real,
    Google-authenticated) account, then delete the guest account.

    Called right after a guest finishes a real Google login, with the guest
    JWT the frontend had stashed in localStorage forwarded as
    `guest_token`. Every TripAccess row the guest had gets reassigned to
    `current_user` (trip access — and role, including "owner" — carries
    over as-is); if `current_user` already independently has access to a
    trip the guest also had access to, the guest's (now-redundant) row is
    just dropped instead of reassigned, to avoid violating TripAccess's
    (trip_id, user_id) UNIQUE constraint. The guest User row itself is
    always deleted afterward — it's meant to be single-use.

    Every failure mode here is a clear 400, never a 500: an expired/forged
    `guest_token`, a token that decodes fine but isn't actually a guest
    account (e.g. someone passing their own real token), or a guest account
    that's already been linked/deleted by an earlier call (this endpoint is
    NOT idempotent by design — a guest's data can only ever be merged into
    one real account, once).
    """
    try:
        guest_payload = decode_access_token(payload.guest_token)
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="訪客登入資訊已過期或無效，無法綁定（你的 Google 帳號已登入成功，只是這個瀏覽器原本的訪客資料沒有合併過來）",
        )

    guest_email = guest_payload.get("email")
    if not guest_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="訪客登入資訊無效，無法綁定")

    guest_user = (
        db.query(models.User)
        .filter(models.User.email == guest_email, models.User.is_guest.is_(True))
        .first()
    )
    if not guest_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="找不到這個訪客帳號，可能已經綁定過或已被清除",
        )
    if guest_user.id == current_user.id:
        # Shouldn't normally happen (current_user is authenticated via a
        # real, non-guest token by get_current_user's contract above — this
        # is just a defensive guard, not a reachable normal-flow case).
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="無法綁定自己")

    guest_accesses = db.query(models.TripAccess).filter(models.TripAccess.user_id == guest_user.id).all()
    for guest_access in guest_accesses:
        existing = (
            db.query(models.TripAccess)
            .filter(
                models.TripAccess.trip_id == guest_access.trip_id,
                models.TripAccess.user_id == current_user.id,
            )
            .first()
        )
        if existing:
            # current_user already has access to this trip (e.g. they were
            # separately invited under their Google account too) — keep
            # that row, drop the guest's now-redundant one rather than
            # violate the (trip_id, user_id) UNIQUE constraint.
            db.delete(guest_access)
        else:
            guest_access.user_id = current_user.id

    # Also repoint any split-Member rows the guest had linked to themselves
    # (see models.Member.user_id / routers/trips.py create_trip & join_trip,
    # which are what set it in the first place) over to the real account —
    # otherwise a guest who created a trip (auto-linked as its first Member)
    # or joined one via invite (auto-linked/created the same way) would lose
    # that "already a connected account" link the moment they upgrade to a
    # real Google login, even though every other trace of their guest
    # identity (TripAccess, above) carries over. Unlike TripAccess.user_id
    # there's no (trip_id, user_id) UNIQUE constraint on members, so no
    # existing/duplicate-row guard is needed here — a plain bulk repoint of
    # every matching row is enough.
    db.query(models.Member).filter(models.Member.user_id == guest_user.id).update(
        {models.Member.user_id: current_user.id}
    )

    # Flush the reassignments/deletes above before deleting the guest User
    # row itself — makes sure no TripAccess row still points at guest_user.id
    # when that DELETE goes out (belt-and-suspenders: TripAccess.user_id is
    # also ondelete="CASCADE" at the DB level, but this keeps the intended
    # "reassigned, not cascaded away" outcome explicit regardless of
    # SQLAlchemy's flush ordering).
    db.flush()
    db.delete(guest_user)
    db.commit()

    return trip_summaries_for_user(db, current_user)
