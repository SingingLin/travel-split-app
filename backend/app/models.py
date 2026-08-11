"""SQLAlchemy ORM models for TravelSplit.

Entity relationships:
  Trip 1--N Member
  Trip 1--N Currency (exactly one is_base=True at all times)
  Trip 1--N Category
  Trip 1--N PaymentMethod
  Trip 1--N Expense
  Expense 1--N ExpenseShare (only populated when Expense.needs_split is True)

Money-history rule: Expense.rate_snapshot / Expense.base_amount and
ExpenseShare.base_amount are captured at write time from the currency's
rate_to_base *at that moment*. Editing a currency's rate later does NOT
retroactively change past expenses' base-currency amounts — see the README
"Design decisions" section for the rationale.
"""
from datetime import datetime, date

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    base_currency_code: Mapped[str] = mapped_column(String(10), nullable=False, default="TWD")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")  # active | settled
    band_color: Mapped[str] = mapped_column(String(20), nullable=False, default="#0d9488")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    members: Mapped[list["Member"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="Member.order_index"
    )
    currencies: Mapped[list["Currency"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan"
    )
    categories: Mapped[list["Category"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan", order_by="Category.order_index"
    )
    payment_methods: Mapped[list["PaymentMethod"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan"
    )
    expenses: Mapped[list["Expense"]] = relationship(
        back_populates="trip", cascade="all, delete-orphan"
    )


AVATAR_COLOR_CYCLE = ["#14b8a6", "#f59e0b", "#8b5cf6", "#f43f5e", "#0ea5e9", "#84cc16", "#f97316"]


class Member(Base):
    __tablename__ = "members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#14b8a6")
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    trip: Mapped["Trip"] = relationship(back_populates="members")


class Currency(Base):
    __tablename__ = "currencies"
    __table_args__ = (UniqueConstraint("trip_id", "code", name="uq_currency_trip_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    code: Mapped[str] = mapped_column(String(10), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    rate_to_base: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    is_base: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    trip: Mapped["Trip"] = relationship(back_populates="currencies")


CATEGORY_COLOR_CYCLE = [
    "#f97316",  # orange-500 吃喝
    "#0ea5e9",  # sky-500 移動
    "#ec4899",  # pink-500 購物
    "#8b5cf6",  # violet-500 票券
    "#6366f1",  # indigo-500 住宿
    "#06b6d4",  # cyan-500 機票
    "#84cc16",  # lime-500 娛樂
]


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#f97316")
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    trip: Mapped["Trip"] = relationship(back_populates="categories")


class PaymentMethod(Base):
    __tablename__ = "payment_methods"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    trip: Mapped["Trip"] = relationship(back_populates="payment_methods")


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency_id: Mapped[int] = mapped_column(ForeignKey("currencies.id", ondelete="RESTRICT"), nullable=False)
    rate_snapshot: Mapped[float] = mapped_column(Float, nullable=False)
    base_amount: Mapped[float] = mapped_column(Float, nullable=False)
    payer_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    payment_method_id: Mapped[int | None] = mapped_column(
        ForeignKey("payment_methods.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    needs_split: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    trip: Mapped["Trip"] = relationship(back_populates="expenses")
    category: Mapped["Category | None"] = relationship()
    currency: Mapped["Currency"] = relationship()
    payer: Mapped["Member"] = relationship(foreign_keys=[payer_id])
    payment_method: Mapped["PaymentMethod | None"] = relationship()
    shares: Mapped[list["ExpenseShare"]] = relationship(
        back_populates="expense", cascade="all, delete-orphan"
    )


class ExpenseShare(Base):
    __tablename__ = "expense_shares"
    __table_args__ = (UniqueConstraint("expense_id", "member_id", name="uq_share_expense_member"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="CASCADE"), nullable=False)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    base_amount: Mapped[float] = mapped_column(Float, nullable=False)
    is_settled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    expense: Mapped["Expense"] = relationship(back_populates="shares")
    member: Mapped["Member"] = relationship()
