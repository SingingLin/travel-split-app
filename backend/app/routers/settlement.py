from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.database import get_db
from app.services.settlement import compute_settlement

router = APIRouter(tags=["settlement"])


@router.get("/api/trips/{trip_id}/settlement", response_model=schemas.SettlementOut)
def get_settlement(trip_id: int, currency: str | None = None, db: Session = Depends(get_db)):
    trip = db.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    members = db.query(models.Member).filter(models.Member.trip_id == trip_id).order_by(models.Member.order_index).all()
    currencies = db.query(models.Currency).filter(models.Currency.trip_id == trip_id).all()
    expenses = (
        db.query(models.Expense)
        .options(selectinload(models.Expense.shares))
        .filter(models.Expense.trip_id == trip_id)
        .all()
    )

    target_code = (currency or trip.base_currency_code).upper()
    target_currency = next((c for c in currencies if c.code == target_code), None)
    if not target_currency:
        raise HTTPException(status_code=400, detail=f"Unknown currency '{target_code}' for this trip")

    # base_amount (snapshotted, in trip base currency) -> target display currency.
    # rate_to_base means "1 unit of `currency` = rate_to_base units of base",
    # so converting FROM base TO target divides by target's rate_to_base.
    def to_display(base_amount: float) -> float:
        return round(base_amount / target_currency.rate_to_base, 2)

    plain_members = [{"id": m.id, "name": m.name, "color": m.color} for m in members]
    plain_expenses = []
    for e in expenses:
        plain_expenses.append(
            {
                "payer_id": e.payer_id,
                "amount": to_display(e.base_amount),
                "needs_split": e.needs_split,
                "shares": [{"member_id": s.member_id, "amount": to_display(s.base_amount)} for s in e.shares],
            }
        )

    result = compute_settlement(plain_members, plain_expenses)

    member_by_id = {m.id: m for m in members}
    member_summaries = [
        schemas.MemberSettlementOut(
            member_id=ms["member_id"],
            name=member_by_id[ms["member_id"]].name,
            color=member_by_id[ms["member_id"]].color,
            total_owed=ms["total_owed"],
            total_paid=ms["total_paid"],
            net=ms["net"],
        )
        for ms in result["members"]
    ]

    return schemas.SettlementOut(
        currency_code=target_code,
        members=member_summaries,
        matrix=[schemas.DebtCell(**c) for c in result["matrix"]],
        raw_relationship_count=result["raw_relationship_count"],
        suggested_transfers=[schemas.TransferSuggestion(**t) for t in result["suggested_transfers"]],
    )
