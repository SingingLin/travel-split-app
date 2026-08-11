from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.constants import DEFAULT_PAYMENT_METHODS
from app.database import get_db

router = APIRouter(tags=["payment_methods"])


@router.get("/api/trips/{trip_id}/payment-methods", response_model=list[schemas.PaymentMethodOut])
def list_payment_methods(trip_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.PaymentMethod)
        .filter(models.PaymentMethod.trip_id == trip_id)
        .order_by(models.PaymentMethod.order_index)
        .all()
    )


@router.post("/api/trips/{trip_id}/payment-methods", response_model=schemas.PaymentMethodOut, status_code=201)
def create_payment_method(trip_id: int, payload: schemas.PaymentMethodCreate, db: Session = Depends(get_db)):
    if not db.get(models.Trip, trip_id):
        raise HTTPException(status_code=404, detail="Trip not found")
    count = (
        db.query(func.count(models.PaymentMethod.id))
        .filter(models.PaymentMethod.trip_id == trip_id)
        .scalar()
        or 0
    )
    pm = models.PaymentMethod(trip_id=trip_id, name=payload.name, order_index=count)
    db.add(pm)
    db.commit()
    db.refresh(pm)
    return pm


@router.post("/api/trips/{trip_id}/payment-methods/reset", response_model=list[schemas.PaymentMethodOut])
def reset_payment_methods(trip_id: int, db: Session = Depends(get_db)):
    """Wipe this trip's payment methods and recreate the default set (same
    list used at trip-creation time, see constants.py). Safe at the DB level:
    Expense.payment_method_id is ondelete="SET NULL" (models.py), so expenses
    that referenced a deleted payment method simply become unset instead of
    failing/cascading.
    """
    if not db.get(models.Trip, trip_id):
        raise HTTPException(status_code=404, detail="Trip not found")
    db.query(models.PaymentMethod).filter(models.PaymentMethod.trip_id == trip_id).delete()
    created = []
    for i, name in enumerate(DEFAULT_PAYMENT_METHODS):
        pm = models.PaymentMethod(trip_id=trip_id, name=name, order_index=i)
        db.add(pm)
        created.append(pm)
    db.commit()
    for pm in created:
        db.refresh(pm)
    return created


@router.put("/api/payment-methods/{pm_id}", response_model=schemas.PaymentMethodOut)
def update_payment_method(pm_id: int, payload: schemas.PaymentMethodCreate, db: Session = Depends(get_db)):
    pm = db.get(models.PaymentMethod, pm_id)
    if not pm:
        raise HTTPException(status_code=404, detail="Payment method not found")
    pm.name = payload.name
    db.commit()
    db.refresh(pm)
    return pm


@router.delete("/api/payment-methods/{pm_id}", status_code=204)
def delete_payment_method(pm_id: int, db: Session = Depends(get_db)):
    pm = db.get(models.PaymentMethod, pm_id)
    if not pm:
        raise HTTPException(status_code=404, detail="Payment method not found")
    db.delete(pm)
    db.commit()
    return None
