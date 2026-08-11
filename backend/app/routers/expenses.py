from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.database import get_db
from app.services.split import equal_split, shares_sum_matches_total

router = APIRouter(tags=["expenses"])


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


@router.post("/api/trips/{trip_id}/expenses/split-preview")
def split_preview(trip_id: int, payload: SplitPreviewRequest, db: Session = Depends(get_db)):
    """Equal-split preview used by the '平均分攤' button — single source of
    truth for the rounding/remainder rule, shared by create & edit forms."""
    return equal_split(payload.amount, payload.member_ids)


def _build_shares(db: Session, expense: models.Expense, payload, rate_snapshot: float):
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
    if not shares_sum_matches_total(shares_dict, payload.amount):
        total = sum(shares_dict.values())
        raise HTTPException(
            status_code=400,
            detail=f"Split shares sum ({total:.2f}) does not match expense amount ({payload.amount:.2f})",
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
def create_expense(trip_id: int, payload: schemas.ExpenseCreate, db: Session = Depends(get_db)):
    if not db.get(models.Trip, trip_id):
        raise HTTPException(status_code=404, detail="Trip not found")
    currency, _payer = _validate_refs(db, trip_id, payload)

    rate_snapshot = currency.rate_to_base
    expense = models.Expense(
        trip_id=trip_id,
        date=payload.date,
        category_id=payload.category_id,
        name=payload.name,
        amount=payload.amount,
        currency_id=payload.currency_id,
        rate_snapshot=rate_snapshot,
        base_amount=round(payload.amount * rate_snapshot, 2),
        payer_id=payload.payer_id,
        payment_method_id=payload.payment_method_id,
        note=payload.note,
        needs_split=payload.needs_split,
    )
    db.add(expense)
    _build_shares(db, expense, payload, rate_snapshot)
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
def get_expense(trip_id: int, expense_id: int, db: Session = Depends(get_db)):
    return _get_expense_or_404(db, trip_id, expense_id)


@router.put("/api/trips/{trip_id}/expenses/{expense_id}", response_model=schemas.ExpenseOut)
def update_expense(trip_id: int, expense_id: int, payload: schemas.ExpenseUpdate, db: Session = Depends(get_db)):
    expense = _get_expense_or_404(db, trip_id, expense_id)

    merged_data = schemas.ExpenseCreate(
        date=payload.date if payload.date is not None else expense.date,
        category_id=payload.category_id if payload.category_id is not None else expense.category_id,
        name=payload.name if payload.name is not None else expense.name,
        amount=payload.amount if payload.amount is not None else expense.amount,
        currency_id=payload.currency_id if payload.currency_id is not None else expense.currency_id,
        payer_id=payload.payer_id if payload.payer_id is not None else expense.payer_id,
        payment_method_id=(
            payload.payment_method_id if payload.payment_method_id is not None else expense.payment_method_id
        ),
        note=payload.note if payload.note is not None else expense.note,
        needs_split=payload.needs_split if payload.needs_split is not None else expense.needs_split,
        shares=(
            payload.shares
            if payload.shares is not None
            else [
                schemas.ExpenseShareIn(member_id=s.member_id, amount=s.amount, is_settled=s.is_settled)
                for s in expense.shares
            ]
        ),
    )

    currency, _payer = _validate_refs(db, trip_id, merged_data)
    rate_snapshot = currency.rate_to_base

    expense.date = merged_data.date
    expense.category_id = merged_data.category_id
    expense.name = merged_data.name
    expense.amount = merged_data.amount
    expense.currency_id = merged_data.currency_id
    expense.rate_snapshot = rate_snapshot
    expense.base_amount = round(merged_data.amount * rate_snapshot, 2)
    expense.payer_id = merged_data.payer_id
    expense.payment_method_id = merged_data.payment_method_id
    expense.note = merged_data.note
    expense.needs_split = merged_data.needs_split

    expense.shares.clear()
    db.flush()
    _build_shares(db, expense, merged_data, rate_snapshot)

    db.commit()
    db.refresh(expense)
    return expense


@router.delete("/api/trips/{trip_id}/expenses/{expense_id}", status_code=204)
def delete_expense(trip_id: int, expense_id: int, db: Session = Depends(get_db)):
    expense = _get_expense_or_404(db, trip_id, expense_id)
    db.delete(expense)
    db.commit()
    return None
