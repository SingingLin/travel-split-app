from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session, selectinload

from app import models, schemas
from app.constants import DEFAULT_CATEGORIES, DEFAULT_PAYMENT_METHODS
from app.database import get_db

router = APIRouter(prefix="/api/trips", tags=["trips"])


@router.get("", response_model=list[schemas.TripSummaryOut])
def list_trips(db: Session = Depends(get_db)):
    trips = (
        db.query(models.Trip)
        .options(selectinload(models.Trip.members))
        .order_by(models.Trip.created_at.desc())
        .all()
    )
    result = []
    for trip in trips:
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
            )
        )
    return result


@router.post("", response_model=schemas.TripDetailOut, status_code=201)
def create_trip(payload: schemas.TripCreate, db: Session = Depends(get_db)):
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

    db.commit()
    db.refresh(trip)
    return trip


def _get_trip_or_404(db: Session, trip_id: int) -> models.Trip:
    trip = db.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip


@router.get("/{trip_id}", response_model=schemas.TripDetailOut)
def get_trip(trip_id: int, db: Session = Depends(get_db)):
    return _get_trip_or_404(db, trip_id)


@router.put("/{trip_id}", response_model=schemas.TripDetailOut)
def update_trip(trip_id: int, payload: schemas.TripUpdate, db: Session = Depends(get_db)):
    trip = _get_trip_or_404(db, trip_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(trip, field, value)
    db.commit()
    db.refresh(trip)
    return trip


@router.delete("/{trip_id}", status_code=204)
def delete_trip(trip_id: int, db: Session = Depends(get_db)):
    trip = _get_trip_or_404(db, trip_id)
    db.delete(trip)
    db.commit()
    return None


@router.put("/{trip_id}/base-currency", response_model=schemas.TripDetailOut)
def change_base_currency(trip_id: int, currency_id: int, db: Session = Depends(get_db)):
    """Change which currency is the trip's base. This is a structural change:
    it re-anchors rate_to_base for every currency (all rates are always
    expressed relative to the *current* base), and updates trip.base_currency_code.
    Past expenses' snapshotted base_amount values are NOT recalculated (see
    README "Design decisions" — historical amounts are frozen at write time).
    """
    trip = _get_trip_or_404(db, trip_id)
    new_base = db.get(models.Currency, currency_id)
    if not new_base or new_base.trip_id != trip_id:
        raise HTTPException(status_code=404, detail="Currency not found in this trip")
    if new_base.is_base:
        return trip

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
    return trip
