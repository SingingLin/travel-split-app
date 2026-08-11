from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db

router = APIRouter(tags=["currencies"])


@router.get("/api/trips/{trip_id}/currencies", response_model=list[schemas.CurrencyOut])
def list_currencies(trip_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.Currency)
        .filter(models.Currency.trip_id == trip_id)
        .order_by(models.Currency.is_base.desc(), models.Currency.id)
        .all()
    )


@router.post("/api/trips/{trip_id}/currencies", response_model=schemas.CurrencyOut, status_code=201)
def create_currency(trip_id: int, payload: schemas.CurrencyCreate, db: Session = Depends(get_db)):
    if not db.get(models.Trip, trip_id):
        raise HTTPException(status_code=404, detail="Trip not found")
    existing = (
        db.query(models.Currency)
        .filter(models.Currency.trip_id == trip_id, models.Currency.code == payload.code.upper())
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Currency code already exists for this trip")
    currency = models.Currency(
        trip_id=trip_id,
        code=payload.code.upper(),
        name=payload.name or payload.code.upper(),
        rate_to_base=payload.rate_to_base,
        is_base=False,
    )
    db.add(currency)
    db.commit()
    db.refresh(currency)
    return currency


@router.put("/api/currencies/{currency_id}", response_model=schemas.CurrencyOut)
def update_currency(currency_id: int, payload: schemas.CurrencyUpdate, db: Session = Depends(get_db)):
    currency = db.get(models.Currency, currency_id)
    if not currency:
        raise HTTPException(status_code=404, detail="Currency not found")
    if currency.is_base and payload.rate_to_base is not None and payload.rate_to_base != 1.0:
        raise HTTPException(status_code=400, detail="Base currency rate is always 1.0; change base currency instead")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(currency, field, value)
    db.commit()
    db.refresh(currency)
    return currency


@router.delete("/api/currencies/{currency_id}", status_code=204)
def delete_currency(currency_id: int, db: Session = Depends(get_db)):
    currency = db.get(models.Currency, currency_id)
    if not currency:
        raise HTTPException(status_code=404, detail="Currency not found")
    if currency.is_base:
        raise HTTPException(status_code=400, detail="Cannot delete the base currency")
    in_use = db.query(models.Expense).filter(models.Expense.currency_id == currency_id).first()
    if in_use:
        raise HTTPException(status_code=400, detail="Currency is used by existing expenses")
    db.delete(currency)
    db.commit()
    return None
