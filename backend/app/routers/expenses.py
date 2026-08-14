from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.auth import require_edit_access, require_expense_create_access, require_trip_access
from app.database import get_db
from app.services.split import equal_split, shares_sum_matches_total, weighted_split

router = APIRouter(tags=["expenses"])


def _default_name(expense_type: str) -> str:
    return "收入" if expense_type == "income" else "支出"


def _resolve_name(name: Optional[str], expense_type: str) -> str:
    """Blank/omitted item name -> type-appropriate default ("支出"/"收入"),
    per the "項目名稱改成非必填" requirement — never store an empty string."""
    trimmed = (name or "").strip()
    return trimmed if trimmed else _default_name(expense_type)


def _validate_refs(db: Session, trip_id: int, payload) -> tuple[models.Currency, models.Member]:
    currency = db.get(models.Currency, payload.currency_id)
    if not currency or currency.trip_id != trip_id:
        raise HTTPException(status_code=400, detail="Invalid currency_id for this trip")
    payer = db.get(models.Member, payload.payer_id)
    if not payer or payer.trip_id != trip_id:
        raise HTTPException(status_code=400, detail="Invalid payer_id for this trip")
    if payload.category_id is not None:
        cat = db.get(models.Category, payload.category_id)
        if not cat or cat.trip_id != trip_id:
            raise HTTPException(status_code=400, detail="Invalid category_id for this trip")
    if payload.payment_method_id is not None:
        pm = db.get(models.PaymentMethod, payload.payment_method_id)
        if not pm or pm.trip_id != trip_id:
            raise HTTPException(status_code=400, detail="Invalid payment_method_id for this trip")
    return currency, payer


@router.get("/api/trips/{trip_id}/expenses", response_model=list[schemas.ExpenseOut])
def list_expenses(
    trip_id: int,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
    category_id: Optional[int] = None,
    payer_id: Optional[int] = None,
    search: Optional[str] = None,
    access: models.TripAccess = Depends(require_trip_access),
    db: Session = Depends(get_db),
):
    q = (
        db.query(models.Expense)
        .options(selectinload(models.Expense.shares))
        .filter(models.Expense.trip_id == trip_id)
    )
    if date_from:
        q = q.filter(models.Expense.date >= date_from)
    if date_to:
        q = q.filter(models.Expense.date <= date_to)
    if category_id:
        q = q.filter(models.Expense.category_id == category_id)
    if payer_id:
        q = q.filter(models.Expense.payer_id == payer_id)
    if search:
        q = q.filter(models.Expense.name.ilike(f"%{search}%"))
    return q.order_by(models.Expense.date.desc(), models.Expense.id.desc()).all()


class SplitPreviewRequest(schemas.BaseModel):
    amount: float
    member_ids: list[int]
    # Optional "依份數分攤" (weighted split) input: member_id -> positive
    # integer share count. When provided (non-empty), weighted_split is used
    # instead of the default equal_split — member_ids is ignored in that case
    # (the keys of `shares` are the source of truth for who participates).
    # Omitted/empty keeps the original equal-split behavior, so existing
    # callers (the '平均分攤' mode) are unaffected.
    shares: Optional[dict[int, int]] = None


@router.post("/api/trips/{trip_id}/expenses/split-preview")
def split_preview(
    trip_id: int,
    payload: SplitPreviewRequest,
    access: models.TripAccess = Depends(require_trip_access),
    db: Session = Depends(get_db),
):
    """Split-amount preview shared by the three split modes in the expense
    form — single source of truth for the rounding/remainder rule:
      - '平均分攤' (equal_split): default, no `shares` in the request.
      - '依份數分攤' (weighted_split): pass `shares` = {member_id: share_count}.
    '自訂金額' mode doesn't call this at all (the user types amounts directly)."""
    if payload.shares:
        try:
            return weighted_split(payload.amount, payload.shares)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    return equal_split(payload.amount, payload.member_ids)


def _build_shares(db: Session, expense: models.Expense, payload, rate_snapshot: float, total_amount: float):
    """`total_amount` is the amount shares must sum to — the *effective*
    amount (payload.amount + foreign_fee), not the raw payload.amount, so a
    credit-card expense's foreign transaction fee is actually split among
    participants rather than silently absorbed by nobody (see foreign_fee on
    models.Expense)."""
    if not payload.needs_split:
        return
    if not payload.shares:
        raise HTTPException(status_code=400, detail="needs_split=true requires at least one share")
    member_ids = [s.member_id for s in payload.shares]
    if len(member_ids) != len(set(member_ids)):
        raise HTTPException(status_code=400, detail="Duplicate member in shares")
    for mid in member_ids:
        m = db.get(models.Member, mid)
        if not m or m.trip_id != expense.trip_id:
            raise HTTPException(status_code=400, detail=f"Invalid member_id {mid} in shares")

    shares_dict = {s.member_id: s.amount for s in payload.shares}
    if not shares_sum_matches_total(shares_dict, total_amount):
        total = sum(shares_dict.values())
        raise HTTPException(
            status_code=400,
            detail=f"Split shares sum ({total:.2f}) does not match expense amount ({total_amount:.2f})",
        )

    for s in payload.shares:
        expense.shares.append(
            models.ExpenseShare(
                member_id=s.member_id,
                amount=s.amount,
                base_amount=round(s.amount * rate_snapshot, 2),
                is_settled=s.is_settled,
            )
        )


@router.post("/api/trips/{trip_id}/expenses", response_model=schemas.ExpenseOut, status_code=201)
def create_expense(
    trip_id: int,
    payload: schemas.ExpenseCreate,
    # The one endpoint a "contributor" (guest) may write to — see
    # app/auth.py require_expense_create_access's docstring. Every other
    # write in this router (update_expense, delete_expense below) stays on
    # require_edit_access, which rejects "contributor" the same as "viewer".
    access: models.TripAccess = Depends(require_expense_create_access),
    db: Session = Depends(get_db),
):
    if not db.get(models.Trip, trip_id):
        raise HTTPException(status_code=404, detail="Trip not found")
    currency, _payer = _validate_refs(db, trip_id, payload)

    rate_snapshot = payload.rate_override if payload.rate_override is not None else currency.rate_to_base
    effective_amount = payload.amount + (payload.foreign_fee or 0.0)
    expense = models.Expense(
        trip_id=trip_id,
        date=payload.date,
        category_id=payload.category_id,
        name=_resolve_name(payload.name, payload.type),
        amount=payload.amount,
        foreign_fee=payload.foreign_fee,
        currency_id=payload.currency_id,
        rate_snapshot=rate_snapshot,
        base_amount=round(effective_amount * rate_snapshot, 2),
        payer_id=payload.payer_id,
        payment_method_id=payload.payment_method_id,
        note=payload.note,
        needs_split=payload.needs_split,
        type=payload.type,
        image_url=payload.image_url,
    )
    db.add(expense)
    _build_shares(db, expense, payload, rate_snapshot, effective_amount)
    db.commit()
    db.refresh(expense)
    return expense


def _get_expense_or_404(db: Session, trip_id: int, expense_id: int) -> models.Expense:
    expense = (
        db.query(models.Expense)
        .options(selectinload(models.Expense.shares))
        .filter(models.Expense.id == expense_id, models.Expense.trip_id == trip_id)
        .first()
    )
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    return expense


@router.get("/api/trips/{trip_id}/expenses/{expense_id}", response_model=schemas.ExpenseOut)
def get_expense(
    trip_id: int,
    expense_id: int,
    access: models.TripAccess = Depends(require_trip_access),
    db: Session = Depends(get_db),
):
    return _get_expense_or_404(db, trip_id, expense_id)


@router.put("/api/trips/{trip_id}/expenses/{expense_id}", response_model=schemas.ExpenseOut)
def update_expense(
    trip_id: int,
    expense_id: int,
    payload: schemas.ExpenseUpdate,
    access: models.TripAccess = Depends(require_edit_access),
    db: Session = Depends(get_db),
):
    expense = _get_expense_or_404(db, trip_id, expense_id)

    # Merge by "was this field explicitly present in the request", not by
    # "is it non-None" — the latter silently ignored requests that clear a
    # nullable field to None (e.g. category_id/payment_method_id -> 未分類/
    # 未指定) because `payload.category_id is not None` is False for an
    # explicit `null` just as much as for an omitted field, so it fell back
    # to the *old* value instead of clearing it. model_fields_set tells us
    # exactly which keys the client actually sent.
    fields_set = payload.model_fields_set

    def merged(field: str):
        return getattr(payload, field) if field in fields_set else getattr(expense, field)

    merged_shares = (
        payload.shares
        if "shares" in fields_set
        else [
            schemas.ExpenseShareIn(member_id=s.member_id, amount=s.amount, is_settled=s.is_settled)
            for s in expense.shares
        ]
    )

    # rate_override isn't a persisted column (only rate_snapshot, the number
    # it resolved to, is stored) — so unlike the other merged() fields there's
    # no `expense.rate_override` to fall back to. Not resending it on an
    # update means "recompute rate_snapshot from the currency's current
    # rate_to_base", same as this endpoint always did before rate_override
    # existed; it does NOT mean "keep whatever override was used last time".
    rate_override = payload.rate_override if "rate_override" in fields_set else None

    merged_data = schemas.ExpenseCreate(
        date=merged("date"),
        category_id=merged("category_id"),
        name=merged("name"),
        amount=merged("amount"),
        foreign_fee=merged("foreign_fee"),
        currency_id=merged("currency_id"),
        rate_override=rate_override,
        payer_id=merged("payer_id"),
        payment_method_id=merged("payment_method_id"),
        note=merged("note"),
        needs_split=merged("needs_split"),
        shares=merged_shares,
        type=merged("type"),
        image_url=merged("image_url"),
    )

    currency, _payer = _validate_refs(db, trip_id, merged_data)
    rate_snapshot = merged_data.rate_override if merged_data.rate_override is not None else currency.rate_to_base
    effective_amount = merged_data.amount + (merged_data.foreign_fee or 0.0)

    expense.date = merged_data.date
    expense.category_id = merged_data.category_id
    expense.name = _resolve_name(merged_data.name, merged_data.type)
    expense.amount = merged_data.amount
    expense.foreign_fee = merged_data.foreign_fee
    expense.currency_id = merged_data.currency_id
    expense.rate_snapshot = rate_snapshot
    expense.base_amount = round(effective_amount * rate_snapshot, 2)
    expense.payer_id = merged_data.payer_id
    expense.payment_method_id = merged_data.payment_method_id
    expense.note = merged_data.note
    expense.needs_split = merged_data.needs_split
    expense.type = merged_data.type
    expense.image_url = merged_data.image_url

    expense.shares.clear()
    db.flush()
    _build_shares(db, expense, merged_data, rate_snapshot, effective_amount)

    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/api/trips/{trip_id}/expenses/{expense_id}", status_code=204)
def delete_expense(
    trip_id: int,
    expense_id: int,
    access: models.TripAccess = Depends(require_edit_access),
    db: Session = Depends(get_db),
):
    expense = _get_expense_or_404(db, trip_id, expense_id)
    db.delete(expense)
    db.commit()
    return None
