from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import check_edit_access, get_current_user, require_edit_access, require_trip_access
from app.database import get_db

router = APIRouter(tags=["members"])

# The five per-member "初始換匯" fields on schemas.MemberUpdate — see
# update_member below for why these (and only these) get an extra
# "only the linked account's own owner may touch this" check on top of the
# normal check_edit_access gate. Kept as one tuple so the "which fields does
# this rule apply to" list can't drift between the `field in payload.
# model_fields_set` write loop and the permission check above it.
_EXCHANGE_FIELDS = (
    "initial_exchange_from_currency",
    "initial_exchange_from_amount",
    "initial_exchange_to_currency",
    "initial_exchange_to_amount",
    "initial_exchange_rate",
)


@router.get("/api/trips/{trip_id}/members", response_model=list[schemas.MemberOut])
def list_members(trip_id: int, access: models.TripAccess = Depends(require_trip_access), db: Session = Depends(get_db)):
    return (
        db.query(models.Member)
        .filter(models.Member.trip_id == trip_id)
        .order_by(models.Member.order_index)
        .all()
    )


@router.post("/api/trips/{trip_id}/members", response_model=schemas.MemberOut, status_code=201)
def create_member(
    trip_id: int,
    payload: schemas.MemberCreate,
    access: models.TripAccess = Depends(require_edit_access),
    db: Session = Depends(get_db),
):
    if not db.get(models.Trip, trip_id):
        raise HTTPException(status_code=404, detail="Trip not found")
    count = db.query(func.count(models.Member.id)).filter(models.Member.trip_id == trip_id).scalar() or 0
    member = models.Member(
        trip_id=trip_id,
        name=payload.name,
        color=models.AVATAR_COLOR_CYCLE[count % len(models.AVATAR_COLOR_CYCLE)],
        order_index=count,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.put("/api/members/{member_id}", response_model=schemas.MemberOut)
def update_member(
    member_id: int,
    payload: schemas.MemberUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Renames the member and (new this round) updates its own per-person
    "初始換匯" record (see models.Member's docstring / schemas.MemberUpdate)
    in the same call — the five initial_exchange_* fields are read via
    exclude_unset so a caller that only sends `name` (every pre-existing
    caller, e.g. PeopleSection.tsx's inline-rename) leaves them untouched,
    while PeopleSection.tsx's per-member exchange panel can send them
    explicitly (including explicit nulls to clear a field) without also
    having to resend `name` as a no-op.

    Exchange-field ownership check ("只有本人能管理自己的換匯" rule, tightened
    this round): "初始換匯" is meant to record "this specific person brought
    this much money", so only the linked login account (`member.user_id ==
    current_user.id`) may write its own exchange fields — even an owner who
    can edit everything else about the trip. This now also covers an
    unlinked Member (`member.user_id is None`, a plain typed-in name with
    nobody to log in as "them"): previously an owner/editor could fill it in
    on their behalf, but that exception is gone — with no linked account,
    NOBODY may write these fields until the member links one. Renaming
    (`name`) is deliberately NOT covered by this — it stays governed purely
    by check_edit_access below, exactly like before this round."""
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    # No trip_id in this route's URL (only member_id) — look the member up
    # first to learn its trip, then enforce access on that trip. See
    # app/auth.py check_trip_access docstring.
    check_edit_access(db, current_user, member.trip_id)
    exchange_fields_touched = any(field in payload.model_fields_set for field in _EXCHANGE_FIELDS)
    if exchange_fields_touched and member.user_id != current_user.id:
        if member.user_id is None:
            raise HTTPException(status_code=403, detail="這個成員沒有連結帳號，無法記錄換匯")
        raise HTTPException(status_code=403, detail="只有本人能編輯自己的初始換匯紀錄")
    member.name = payload.name
    for field in _EXCHANGE_FIELDS:
        if field in payload.model_fields_set:
            setattr(member, field, getattr(payload, field))
    db.commit()
    db.refresh(member)
    return member


@router.delete("/api/members/{member_id}", status_code=204)
def delete_member(
    member_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    check_edit_access(db, current_user, member.trip_id)
    db.delete(member)
    db.commit()
    return None
