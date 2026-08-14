from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.auth import check_edit_access, get_current_user, require_edit_access, require_trip_access
from app.constants import DEFAULT_CATEGORIES
from app.database import get_db

router = APIRouter(tags=["categories"])


@router.get("/api/trips/{trip_id}/categories", response_model=list[schemas.CategoryOut])
def list_categories(trip_id: int, access: models.TripAccess = Depends(require_trip_access), db: Session = Depends(get_db)):
    return (
        db.query(models.Category)
        .filter(models.Category.trip_id == trip_id)
        .order_by(models.Category.order_index)
        .all()
    )


@router.post("/api/trips/{trip_id}/categories", response_model=schemas.CategoryOut, status_code=201)
def create_category(
    trip_id: int,
    payload: schemas.CategoryCreate,
    access: models.TripAccess = Depends(require_edit_access),
    db: Session = Depends(get_db),
):
    if not db.get(models.Trip, trip_id):
        raise HTTPException(status_code=404, detail="Trip not found")
    count = db.query(func.count(models.Category.id)).filter(models.Category.trip_id == trip_id).scalar() or 0
    category = models.Category(
        trip_id=trip_id,
        name=payload.name,
        color=payload.color or models.CATEGORY_COLOR_CYCLE[count % len(models.CATEGORY_COLOR_CYCLE)],
        order_index=count,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.post("/api/trips/{trip_id}/categories/reset", response_model=list[schemas.CategoryOut])
def reset_categories(trip_id: int, access: models.TripAccess = Depends(require_edit_access), db: Session = Depends(get_db)):
    """Wipe this trip's categories and recreate the default set (same list
    used at trip-creation time, see constants.py). Safe at the DB level:
    Expense.category_id is ondelete="SET NULL" (models.py), so expenses that
    referenced a deleted category simply become uncategorized instead of
    failing/cascading.
    """
    if not db.get(models.Trip, trip_id):
        raise HTTPException(status_code=404, detail="Trip not found")
    db.query(models.Category).filter(models.Category.trip_id == trip_id).delete()
    created = []
    for i, name in enumerate(DEFAULT_CATEGORIES):
        category = models.Category(
            trip_id=trip_id,
            name=name,
            color=models.CATEGORY_COLOR_CYCLE[i % len(models.CATEGORY_COLOR_CYCLE)],
            order_index=i,
        )
        db.add(category)
        created.append(category)
    db.commit()
    for category in created:
        db.refresh(category)
    return created


@router.put("/api/categories/{category_id}", response_model=schemas.CategoryOut)
def update_category(
    category_id: int,
    payload: schemas.CategoryUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    category = db.get(models.Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    check_edit_access(db, current_user, category.trip_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/api/categories/{category_id}", status_code=204)
def delete_category(
    category_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    category = db.get(models.Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    check_edit_access(db, current_user, category.trip_id)
    db.delete(category)
    db.commit()
    return None
