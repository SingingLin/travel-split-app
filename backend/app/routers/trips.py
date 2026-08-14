import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.auth import get_current_user, require_edit_access, require_trip_access
from app.constants import DEFAULT_CATEGORIES, DEFAULT_PAYMENT_METHODS
from app.database import get_db

router = APIRouter(prefix="/api/trips", tags=["trips"])


def _trip_detail_out(trip: models.Trip, role: str) -> schemas.TripDetailOut:
    """Builds a TripDetailOut with the CALLING user's own role folded in
    (see schemas.TripDetailOut.my_role) — every endpoint below that returns
    a full trip-detail payload goes through this so the frontend can gate
    editor/viewer UI (e.g. hiding "新增支出") without a second round-trip.
    `role` is always the caller's own already-resolved TripAccess.role.
    """
    return schemas.TripDetailOut(
        **schemas.TripOut.model_validate(trip).model_dump(),
        members=[schemas.MemberOut.model_validate(m) for m in trip.members],
        currencies=[schemas.CurrencyOut.model_validate(c) for c in trip.currencies],
        categories=[schemas.CategoryOut.model_validate(c) for c in trip.categories],
        payment_methods=[schemas.PaymentMethodOut.model_validate(pm) for pm in trip.payment_methods],
        my_role=role,
    )


def trip_summaries_for_user(db: Session, user: models.User) -> list[schemas.TripSummaryOut]:
    """Every trip `user` currently has TripAccess to (owner or invited
    member), shaped as the trip-list card response — never the full table.
    See app/auth.py's module docstring and the "東京五日自由行" demo-trip
    note in models.Trip/scripts/claim_trip.py for why a trip can legitimately
    have zero visible owners right now.

    Factored out of list_trips below so routers/auth.py's POST
    /api/auth/link-guest can return the exact same "your trips right now"
    shape after merging a guest account's TripAccess rows into a real user —
    it's just list_trips' response, recomputed post-merge, not a separate
    concept.
    """
    trips_with_role = (
        db.query(models.Trip, models.TripAccess.role)
        .join(models.TripAccess, models.TripAccess.trip_id == models.Trip.id)
        .filter(models.TripAccess.user_id == user.id)
        .options(selectinload(models.Trip.members))
        .order_by(models.Trip.created_at.desc())
        .all()
    )
    result = []
    for trip, my_role in trips_with_role:
        # income rows net *against* total spend (same signed-amount convention
        # as services/settlement.py) rather than adding to it — otherwise a
        # trip that logs a refund/income would show an inflated "總花費".
        signed_base_amount = case(
            (models.Expense.type == "income", -models.Expense.base_amount),
            else_=models.Expense.base_amount,
        )
        total = (
            db.query(func.coalesce(func.sum(signed_base_amount), 0.0))
            .filter(models.Expense.trip_id == trip.id)
            .scalar()
        )
        result.append(
            schemas.TripSummaryOut(
                **schemas.TripOut.model_validate(trip).model_dump(),
                members=[schemas.MemberOut.model_validate(m) for m in trip.members],
                total_base_amount=round(total or 0.0, 2),
                my_role=my_role,
            )
        )
    return result


@router.get("", response_model=list[schemas.TripSummaryOut])
def list_trips(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return trip_summaries_for_user(db, current_user)


@router.post("", response_model=schemas.TripDetailOut, status_code=201)
def create_trip(
    payload: schemas.TripCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Guest identities only ever exist to redeem an invite link's restricted
    # "contributor" access (see this round's "訪客也能是完整成員" simplification
    # task spec / join_trip below) — a guest has no trip to invite anyone
    # into in the first place, so creating a brand-new trip is blocked
    # outright rather than silently letting a guest become a full owner.
    if current_user.is_guest:
        raise HTTPException(status_code=403, detail="訪客身分無法建立新行程，請使用 Google 帳號登入")
    trip = models.Trip(
        name=payload.name,
        base_currency_code=payload.base_currency_code,
        start_date=payload.start_date,
        end_date=payload.end_date,
        band_color=payload.band_color or "#0d9488",
        initial_budget=payload.initial_budget,
        initial_exchange_from_currency=payload.initial_exchange_from_currency,
        initial_exchange_from_amount=payload.initial_exchange_from_amount,
        initial_exchange_to_currency=payload.initial_exchange_to_currency,
        initial_exchange_to_amount=payload.initial_exchange_to_amount,
        initial_exchange_rate=payload.initial_exchange_rate,
    )
    db.add(trip)
    db.flush()

    base_currency = models.Currency(
        trip_id=trip.id,
        code=payload.base_currency_code,
        name=payload.base_currency_name or payload.base_currency_code,
        rate_to_base=1.0,
        is_base=True,
    )
    db.add(base_currency)

    for i, name in enumerate(DEFAULT_CATEGORIES):
        db.add(
            models.Category(
                trip_id=trip.id,
                name=name,
                color=models.CATEGORY_COLOR_CYCLE[i % len(models.CATEGORY_COLOR_CYCLE)],
                order_index=i,
            )
        )
    for i, name in enumerate(DEFAULT_PAYMENT_METHODS):
        db.add(models.PaymentMethod(trip_id=trip.id, name=name, order_index=i))

    # Creator automatically becomes this trip's owner — the only role that
    # can delete the trip or revoke someone else's access (see
    # app/auth.py require_trip_access and the /invite, /access endpoints
    # below).
    db.add(models.TripAccess(trip_id=trip.id, user_id=current_user.id, role="owner"))

    # ...and also automatically becomes this trip's first *split-member* —
    # distinct from TripAccess above (login/permission) — so the creator is
    # already one of the people expenses can be split among without a
    # separate manual "add myself" step. Linked back to current_user.id via
    # Member.user_id so the settings page can show this row as "already a
    # connected account" instead of a plain name (see models.Member's
    # docstring) — a guest or Google user's own display name is simply
    # reused as the first member's name either way.
    db.add(models.Member(trip_id=trip.id, name=current_user.name, user_id=current_user.id, order_index=0))

    db.commit()
    db.refresh(trip)
    return _trip_detail_out(trip, "owner")


def _get_trip_or_404(db: Session, trip_id: int) -> models.Trip:
    trip = db.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip


@router.get("/{trip_id}", response_model=schemas.TripDetailOut)
def get_trip(trip_id: int, access: models.TripAccess = Depends(require_trip_access), db: Session = Depends(get_db)):
    return _trip_detail_out(_get_trip_or_404(db, trip_id), access.role)


@router.put("/{trip_id}", response_model=schemas.TripDetailOut)
def update_trip(
    trip_id: int,
    payload: schemas.TripUpdate,
    access: models.TripAccess = Depends(require_edit_access),
    db: Session = Depends(get_db),
):
    trip = _get_trip_or_404(db, trip_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(trip, field, value)
    db.commit()
    db.refresh(trip)
    return _trip_detail_out(trip, access.role)


@router.delete("/{trip_id}", status_code=204)
def delete_trip(trip_id: int, access: models.TripAccess = Depends(require_edit_access), db: Session = Depends(get_db)):
    if access.role != "owner":
        raise HTTPException(status_code=403, detail="只有行程擁有者能刪除行程")
    trip = _get_trip_or_404(db, trip_id)
    db.delete(trip)
    db.commit()
    return None


@router.put("/{trip_id}/base-currency", response_model=schemas.TripDetailOut)
def change_base_currency(
    trip_id: int,
    currency_id: int,
    access: models.TripAccess = Depends(require_edit_access),
    db: Session = Depends(get_db),
):
    """Change which currency is the trip's base. This is a structural change:
    it re-anchors rate_to_base for every currency (all rates are always
    expressed relative to the *current* base), and updates trip.base_currency_code.
    Past expenses' snapshotted base_amount values are NOT recalculated (see
    README "Design decisions" — historical amounts are frozen at write time).
    Any trip member (not just the owner) may do this — it's a routine
    day-to-day settings change, unlike the irreversible operations
    (delete_trip, remove_trip_access below) that are owner-only.
    """
    trip = _get_trip_or_404(db, trip_id)
    new_base = db.get(models.Currency, currency_id)
    if not new_base or new_base.trip_id != trip_id:
        raise HTTPException(status_code=404, detail="Currency not found in this trip")
    if new_base.is_base:
        return _trip_detail_out(trip, access.role)

    old_base_to_new_base_rate = new_base.rate_to_base  # units of old base per 1 new-base unit
    if old_base_to_new_base_rate <= 0:
        raise HTTPException(status_code=400, detail="Invalid rate on target currency")

    currencies = db.query(models.Currency).filter(models.Currency.trip_id == trip_id).all()
    for cur in currencies:
        if cur.id == new_base.id:
            cur.rate_to_base = 1.0
            cur.is_base = True
        else:
            cur.is_base = False
            # old rate_to_base(cur) = units of OLD base per 1 cur.
            # new rate_to_base(cur) = units of NEW base per 1 cur
            #                       = old_rate(cur) / old_rate(new_base)
            cur.rate_to_base = cur.rate_to_base / old_base_to_new_base_rate

    trip.base_currency_code = new_base.code
    db.commit()
    db.refresh(trip)
    return _trip_detail_out(trip, access.role)


# ---------- Invite / join (multi-person trip access — see app/auth.py) ----------

@router.post("/{trip_id}/invite", response_model=schemas.TripInviteOut)
def create_invite(
    trip_id: int,
    access: models.TripAccess = Depends(require_edit_access),
    db: Session = Depends(get_db),
):
    """Owner-only: return this trip's stable invite code, generating one on
    first call (secrets.token_urlsafe(16) — 22 url-safe chars, not
    realistically guessable). Idempotent: once generated, repeated calls
    return the SAME code rather than rotating it, so a link the owner already
    shared keeps working. Resetting/rotating a compromised code is left for a
    future round.
    """
    if access.role != "owner":
        raise HTTPException(status_code=403, detail="只有行程擁有者能產生邀請連結")
    trip = _get_trip_or_404(db, trip_id)
    if not trip.invite_code:
        trip.invite_code = secrets.token_urlsafe(16)
        db.commit()
        db.refresh(trip)
    return schemas.TripInviteOut(invite_code=trip.invite_code)


@router.get("/join/preview", response_model=schemas.TripJoinPreviewOut)
def join_preview(code: str, db: Session = Depends(get_db)):
    """Unauthenticated preview of what an invite code leads to — deliberately
    no login dependency at all, so app/join/[code]/page.tsx can show "你要
    加入『{trip_name}』" before committing to a login method.

    `unlinked_members` only lists Members with user_id IS NULL on this trip
    (see models.Member.user_id) — kept for a Google joiner's optional
    `claim_member_id` pick (see schemas.TripJoinIn's docstring). No longer
    used by the guest path since this round's "訪客也能是完整成員"
    simplification: a guest never becomes (or claims) a Member at all, so
    app/join/[code]/page.tsx's guest flow doesn't show a member picker
    anymore — it just asks for a display name and redeems the code.
    Invalid/unknown code -> 404, same as POST /api/trips/join.
    """
    trip = db.query(models.Trip).filter(models.Trip.invite_code == code).first()
    if not trip:
        raise HTTPException(status_code=404, detail="邀請連結無效或已失效")
    unlinked = (
        db.query(models.Member)
        .filter(models.Member.trip_id == trip.id, models.Member.user_id.is_(None))
        .order_by(models.Member.order_index)
        .all()
    )
    return schemas.TripJoinPreviewOut(
        trip_name=trip.name,
        unlinked_members=[schemas.UnlinkedMemberOut(id=m.id, name=m.name) for m in unlinked],
    )


@router.post("/join", response_model=schemas.TripDetailOut)
def join_trip(
    payload: schemas.TripJoinIn,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Redeem an invite code to gain access to the trip it belongs to. No
    require_trip_access dependency here on purpose — the whole point of this
    endpoint is to GRANT access to someone who doesn't have it yet, so it
    only requires being logged in (get_current_user), not already having
    trip access.

    Role granted depends on whether the caller is a guest (see this round's
    "訪客也能是完整成員" simplification task spec):
      - Guest (current_user.is_guest): always "contributor" — the
        restricted, expense-creation-only role (see app/auth.py
        require_expense_create_access / models.TripAccess's docstring). A
        guest is NEVER linked to (or causes the creation of) a Member row —
        `payload.claim_member_id` is ignored entirely for a guest, whether
        or not it's present, since "which existing member is this guest"
        isn't a question that applies anymore (a guest is never itself
        selectable as a payer/split participant).
      - Google user (not a guest): unchanged from before this round —
        "editor", with the existing auto-link/auto-create-a-Member and
        claim_member_id logic below still applying as-is.
    """
    trip = db.query(models.Trip).filter(models.Trip.invite_code == payload.invite_code).first()
    if not trip:
        raise HTTPException(status_code=404, detail="邀請連結無效或已失效")

    new_role = "contributor" if current_user.is_guest else "editor"
    existing = (
        db.query(models.TripAccess)
        .filter(models.TripAccess.trip_id == trip.id, models.TripAccess.user_id == current_user.id)
        .first()
    )
    if not existing:
        # Idempotent: joining a trip you already have access to (owner,
        # editor/viewer/contributor) just returns the trip as-is, no
        # duplicate TripAccess row and no error — repeat clicks on a shared
        # invite link should never fail. See `new_role` above for which role
        # a brand-new join lands as.
        db.add(models.TripAccess(trip_id=trip.id, user_id=current_user.id, role=new_role))
        db.commit()

    # Auto-link (or auto-create) a split-Member for whoever just redeemed
    # this invite code — mirrors create_trip's auto-added-creator-as-member
    # behavior above, so "joined via a shared link" also means "already a
    # split participant," without the trip owner having to add them a second
    # time by hand. Checked (not just done inside the `if not existing`
    # branch above) so this also self-heals a trip joined before this round
    # existed — repeat visits to an already-joined trip's invite link will
    # backfill the missing Member link once, then no-op forever after.
    #
    # Guests are entirely excluded from this block: a guest never becomes
    # (or claims) a Member — see this function's docstring above.
    existing_member = (
        db.query(models.Member)
        .filter(models.Member.trip_id == trip.id, models.Member.user_id == current_user.id)
        .first()
    )
    if not current_user.is_guest and not existing_member:
        if payload.claim_member_id is not None:
            # Explicit "我就是這位" pick — must be an unlinked member of THIS
            # trip; anything else is rejected outright rather than silently
            # falling back to auto-create, since a wrong id here would mean
            # linking the wrong person.
            claimed = db.get(models.Member, payload.claim_member_id)
            if not claimed or claimed.trip_id != trip.id:
                raise HTTPException(status_code=404, detail="要認領的成員不存在於這趟行程")
            if claimed.user_id is not None:
                raise HTTPException(status_code=400, detail="這位成員已經連結其他帳號，無法認領")
            claimed.user_id = current_user.id
            db.commit()
        else:
            # Before creating a brand-new Member, try to auto-match an existing
            # *unlinked* Member with the exact same name (trimmed, case-
            # insensitive) — this is the fix for the "owner manually adds 小明 by
            # name, then the real 小明 later joins via invite link and gets a
            # SECOND, duplicate Member" problem (see PeopleSection.tsx's manual
            # "合併" tool for the general-purpose fallback when this auto-match
            # doesn't apply, e.g. names don't match exactly). Only a Member with
            # user_id IS NULL is eligible — never steal a name-collision away
            # from someone else's already-linked account. No fuzzy matching on
            # purpose (see task spec): exact, trimmed, case-insensitive only, to
            # avoid ever linking the wrong person by mistake.
            normalized_name = current_user.name.strip().lower()
            name_match = (
                db.query(models.Member)
                .filter(
                    models.Member.trip_id == trip.id,
                    models.Member.user_id.is_(None),
                    func.lower(func.trim(models.Member.name)) == normalized_name,
                )
                .first()
                if normalized_name
                else None
            )
            if name_match:
                name_match.user_id = current_user.id
                db.commit()
            else:
                count = db.query(func.count(models.Member.id)).filter(models.Member.trip_id == trip.id).scalar() or 0
                db.add(
                    models.Member(
                        trip_id=trip.id,
                        name=current_user.name,
                        user_id=current_user.id,
                        color=models.AVATAR_COLOR_CYCLE[count % len(models.AVATAR_COLOR_CYCLE)],
                        order_index=count,
                    )
                )
                db.commit()

    db.refresh(trip)
    final_access = (
        db.query(models.TripAccess)
        .filter(models.TripAccess.trip_id == trip.id, models.TripAccess.user_id == current_user.id)
        .first()
    )
    # final_access should always exist at this point (either `existing` above
    # or the row just added/committed) — the "editor" fallback is defensive
    # only, never expected to actually fire.
    return _trip_detail_out(trip, final_access.role if final_access else "editor")


@router.get("/{trip_id}/access", response_model=list[schemas.TripAccessUserOut])
def list_trip_access(
    trip_id: int,
    access: models.TripAccess = Depends(require_trip_access),
    db: Session = Depends(get_db),
):
    """Everyone with access to this trip (owner or member) — who currently
    can see/edit it. Powers a future trip-settings "誰能看到這趟" list.

    Each row's `is_me` is set by comparing against `access.user_id` — the
    calling user's own TripAccess row, already resolved by
    require_trip_access above from their auth token. This is deliberately
    NOT re-derived by the frontend (e.g. matching a NextAuth session email
    against `email`), since that approach silently fails for guest callers
    who have no NextAuth session at all. See schemas.TripAccessUserOut's
    docstring.
    """
    rows = (
        db.query(models.TripAccess, models.User)
        .join(models.User, models.TripAccess.user_id == models.User.id)
        .filter(models.TripAccess.trip_id == trip_id)
        .order_by(models.TripAccess.created_at)
        .all()
    )
    return [
        schemas.TripAccessUserOut(
            user_id=user.id,
            email=user.email,
            name=user.name,
            # Same "linked, non-guest, has a stored avatar_url" gating as
            # models.Member.avatar_url — this row already IS the joined User
            # (not a Member with an optional `.user` link), so the gate is
            # just inlined here rather than going through that property.
            avatar_url=user.avatar_url if not user.is_guest and user.avatar_url else None,
            role=ta.role,
            is_me=user.id == access.user_id,
        )
        for ta, user in rows
    ]


@router.delete("/{trip_id}/access/{user_id}", status_code=204)
def remove_trip_access(
    trip_id: int,
    user_id: int,
    access: models.TripAccess = Depends(require_edit_access),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Owner-only: revoke another user's access to this trip AND — same
    transaction, single action from the caller's point of view — delete
    whatever split-Member row this user is linked to on this trip (if any).

    This used to be two independently-triggerable states ("移除存取權" vs the
    separate "刪除成員" action on a linked row) — real-user feedback after
    trying the app was that having "access" and "is a split participant" as
    two separately-removable things for the same linked account was
    confusing (you could end up with "still shows up in the split list but
    can no longer log in and see the trip" or the reverse, neither of which
    reads as a sensible state to be in). The fix: for any account with a
    login (Member.user_id set), access and split-identity now always
    disappear together, enforced here, not left as two separate frontend
    buttons that happen to usually be clicked together. A plain unlinked
    Member (user_id IS NULL) never had access to begin with — deleting it is
    still the separate, unchanged DELETE /api/members/{member_id} endpoint.

    An owner can't remove themselves this way — that would leave the trip
    with no owner at all, so it's rejected outright (ownership transfer is a
    future-round feature, not something to improvise here).

    Both deletes are staged before a single db.commit() so they either both
    happen or neither does — if the linked Member turns out to be the payer
    on an existing expense (Expense.payer_id is ondelete="RESTRICT"; see
    models.py), the whole operation is rolled back and rejected with a clear
    message rather than silently succeeding at revoking access while
    leaving the split-Member orphaned mid-way, or vice versa.
    """
    if access.role != "owner":
        raise HTTPException(status_code=403, detail="只有行程擁有者能移除其他人的存取權限")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="擁有者不能移除自己的存取權限")

    target = (
        db.query(models.TripAccess)
        .filter(models.TripAccess.trip_id == trip_id, models.TripAccess.user_id == user_id)
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="這個使用者沒有這趟行程的存取權限")

    linked_member = (
        db.query(models.Member)
        .filter(models.Member.trip_id == trip_id, models.Member.user_id == user_id)
        .first()
    )

    db.delete(target)
    if linked_member:
        db.delete(linked_member)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        member_name = linked_member.name if linked_member else ""
        raise HTTPException(
            status_code=400,
            detail=(
                f"無法移除「{member_name}」的存取權限：這位成員已經是某些支出的付款人，"
                "刪除會讓那些支出失去付款人。請先透過「合併成員」把他的支出轉移給其他成員，再重新嘗試移除。"
            ),
        )
    return None


@router.put("/{trip_id}/access/{user_id}", response_model=schemas.TripAccessOut)
def update_trip_access_role(
    trip_id: int,
    user_id: int,
    payload: schemas.TripAccessRoleUpdate,
    access: models.TripAccess = Depends(require_edit_access),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Owner-only: switch another user's role between "editor" and "viewer".

    Never lets anyone become "owner" through this endpoint — payload.role's
    Literal["editor", "viewer"] type already rejects that at the request-
    validation layer, before this function body even runs. Also never lets
    the owner change their OWN role (including "demoting" themselves) or
    change another owner's role (ownership transfer is a future-round
    feature, not something to improvise here) — both explicitly checked
    below since the Literal type alone can't express either rule.

    Also never lets a "contributor" (guest) row be switched to "editor" or
    "viewer" here: "contributor" is a fixed, permanent role only ever granted
    by join_trip's is_guest branch (see models.TripAccess's docstring) — a
    guest is deliberately never linked to a Member row, and letting one get
    promoted to "editor"/"viewer" through this endpoint would produce exactly
    the kind of guest-with-a-non-contributor-role combination the rest of the
    app assumes can never happen (e.g. PeopleSection.tsx's accessOnlyRows
    rendering, which treats every "contributor" row as a guest with no linked
    Member by design). Checked the same way as the "owner" guard above.
    """
    if access.role != "owner":
        raise HTTPException(status_code=403, detail="只有行程擁有者能變更其他人的權限")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能變更自己的權限")

    target = (
        db.query(models.TripAccess)
        .filter(models.TripAccess.trip_id == trip_id, models.TripAccess.user_id == user_id)
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="這個使用者沒有這趟行程的存取權限")
    if target.role == "owner":
        raise HTTPException(status_code=400, detail="不能變更擁有者的權限")
    if target.role == "contributor":
        raise HTTPException(status_code=400, detail="訪客身分固定是唯記帳角色，無法變更")

    target.role = payload.role
    db.commit()
    db.refresh(target)
    return target


# ---------- Manual member merge (see models.Member.user_id docstring / the
# join_trip name-auto-match above for the automatic half of this feature) ----------

@router.post(
    "/{trip_id}/members/{member_id}/merge-into/{target_member_id}",
    response_model=schemas.MemberOut,
)
def merge_member(
    trip_id: int,
    member_id: int,
    target_member_id: int,
    access: models.TripAccess = Depends(require_edit_access),
    db: Session = Depends(get_db),
):
    """Owner-only. Folds `member_id` into `target_member_id`: every Expense
    this member ever paid and every ExpenseShare they were assigned gets
    reassigned to `target_member_id`, then `member_id` is deleted. This is
    the general-purpose, manual fallback for the "same real person shows up
    as two Members" problem — join_trip's name-auto-match above only catches
    the exact-name case at the moment someone joins; this tool cleans up
    everything else (near-miss names, duplicates that already happened
    before this round existed, etc.).

    Merge-direction rule (deliberately conservative — see below for why):
    `member_id` (the one being deleted) MUST be unlinked (user_id IS NULL).
    `target_member_id` (the one being kept) may be linked or unlinked, no
    restriction. Rationale: a Member.user_id is a login-identity link with no
    duplicate/backup copy anywhere else in this schema — if member_id had one
    and got deleted, that account's "which split-participant am I" link would
    just be gone, with no way to recover it short of the user manually
    re-adding themselves. Requiring the *deleted* side to always be the
    unlinked one makes data loss structurally impossible: the surviving
    Member (target) always keeps whatever link(s) already existed, and the
    only thing that can vanish is a plain name with no login attached to it
    (which is exactly what this feature is for — collapsing "just a name"
    into a real, connected person). A caller who actually wants to merge two
    *linked* members (e.g. bona fide duplicate Google logins) isn't supported
    here at all — that's a different, rarer problem this round doesn't
    attempt to solve automatically, since silently picking one login to keep
    over another is exactly the kind of judgment call this endpoint's whole
    design goal is to avoid making on the user's behalf.
    """
    if access.role != "owner":
        raise HTTPException(status_code=403, detail="只有行程擁有者能合併成員")
    if member_id == target_member_id:
        raise HTTPException(status_code=400, detail="不能把成員合併到自己")

    source = db.get(models.Member, member_id)
    if not source or source.trip_id != trip_id:
        raise HTTPException(status_code=404, detail="要合併的成員不存在於這趟行程")
    target = db.get(models.Member, target_member_id)
    if not target or target.trip_id != trip_id:
        raise HTTPException(status_code=404, detail="合併目標成員不存在於這趟行程")

    if source.user_id is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"「{source.name}」已連結帳號，無法把它合併掉（會遺失這個帳號和分帳身分的連結）。"
                "只能把「未連結帳號」的成員合併進其他成員——如果你想合併兩個都已連結帳號的成員，"
                "目前需要先手動移除其中一個的存取權限，再進行合併。"
            ),
        )

    # 1) Every expense this member ever paid -> now paid by target.
    db.query(models.Expense).filter(models.Expense.payer_id == member_id).update(
        {models.Expense.payer_id: target_member_id}
    )

    # 2) Every expense-share assigned to this member -> reassigned to target.
    # The tricky part (see task spec / this function's test coverage): the
    # SAME expense might already have a share row for target_member_id too
    # (uq_share_expense_member's (expense_id, member_id) UNIQUE constraint)
    # — a plain reassignment would violate that constraint. When that
    # happens, combine the two shares into target's row instead of just
    # overwriting/dropping one: sum both `amount`/`base_amount` (the honest
    # total both "copies" of this person owe on that expense) and mark the
    # combined row settled only if BOTH original shares were already
    # settled — if either portion still needs to be paid, the merged share
    # should still show up as outstanding, not silently mark real unpaid
    # money as settled.
    source_shares = db.query(models.ExpenseShare).filter(models.ExpenseShare.member_id == member_id).all()
    for share in source_shares:
        conflicting = (
            db.query(models.ExpenseShare)
            .filter(
                models.ExpenseShare.expense_id == share.expense_id,
                models.ExpenseShare.member_id == target_member_id,
            )
            .first()
        )
        if conflicting:
            conflicting.amount += share.amount
            conflicting.base_amount += share.base_amount
            conflicting.is_settled = conflicting.is_settled and share.is_settled
            db.delete(share)
        else:
            share.member_id = target_member_id
    db.flush()

    db.delete(source)
    db.commit()
    db.refresh(target)
    return target
