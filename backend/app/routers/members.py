from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db

router = APIRouter(tags=["members"])


@router.get("/api/trips/{trip_id}/members", response_model=list[schemas.MemberOut])
def list_members(trip_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.Member)
        .filter(models.Member.trip_id == trip_id)
        .order_by(models.Member.order_index)
        .all()
    )


@router.post("/api/trips/{trip_id}/members", response_model=schemas.MemberOut, status_code=201)
def create_member(trip_id: int, payload: schemas.MemberCreate, db: Session = Depends(get_db)):
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
def update_member(member_id: int, payload: schemas.MemberCreate, db: Session = Depends(get_db)):
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    member.name = payload.name
    db.commit()
    db.refresh(member)
    return member


@router.delete("/api/members/{member_id}", status_code=204)
def delete_member(member_id: int, db: Session = Depends(get_db)):
    member = db.get(models.Member, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    db.commit()
    return None
