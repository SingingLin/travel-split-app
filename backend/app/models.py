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
    # Optional "這次帶了多少錢去旅行" reference figure, always denominated in
    # this trip's base_currency_code (no separate currency picker — keeps the
    # settlement-page budget-vs-spend comparison a simple subtraction). NULL
    # when the user never filled it in (comparison UI just hides itself).
    # Added via database.ensure_columns (SQLite ADD COLUMN), not create_all —
    # see that function's docstring for why a plain model field alone isn't
    # enough to keep the existing DB file working after this change.
    #
    # Superseded by the initial_exchange_* fields below (a fuller "換匯紀錄"
    # that also captures which currency the money started/ended as and the
    # actual rate used) — left in place unused rather than dropped, per this
    # project's no-migration-tooling policy (see ensure_columns docstring).
    # The settlement page now reads initial_exchange_to_amount instead of
    # this field for its budget-vs-spend comparison.
    initial_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    # "初始換匯" record — optional, all-or-nothing-ish but every field is
    # independently nullable/editable (see schemas.py Trip*/TripInfoSection.tsx):
    # the user exchanged `initial_exchange_from_amount` units of
    # `initial_exchange_from_currency` into `initial_exchange_to_amount` units
    # of `initial_exchange_to_currency`, at the actual historical rate
    # `initial_exchange_rate` they got at the bank/exchange booth (which can
    # legitimately differ from this trip's live Currency.rate_to_base due to
    # rounding/fees — never overwritten by the app's own rate lookups once
    # saved). Direction convention for initial_exchange_rate matches this
    # project's rate_to_base convention throughout: "1 unit of
    # initial_exchange_to_currency = initial_exchange_rate units of
    # initial_exchange_from_currency". The three numeric fields
    # (from_amount/to_amount/rate) are mathematically related
    # (from_amount = to_amount * rate) but intentionally NOT enforced to
    # match exactly — real-world exchanges have fees/rounding, so each is
    # independently stored as whatever the user actually left in that field
    # (see TripInfoSection.tsx for the "fill any two, suggest the third,
    # but never force-overwrite" UI behavior). initial_exchange_to_amount
    # (the currency actually carried while traveling) is what
    # SettlementPageClient.tsx's budget-vs-spend comparison uses; the whole
    # comparison hides itself when this is NULL. Added via
    # database.ensure_columns, same caveat as initial_budget above.
    initial_exchange_from_currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    initial_exchange_from_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    initial_exchange_to_currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    initial_exchange_to_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    initial_exchange_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
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
    # Optional "海外手續費" (foreign transaction fee), same currency/rate as
    # `amount` — only meaningful when payment_method is a credit card, but
    # not DB-enforced (the frontend gates when it's shown/editable). NULL for
    # every expense that predates this feature or simply has no fee; treat as
    # 0 wherever it's summed (see `effective_amount` below).
    # Added via database.ensure_columns (SQLite ADD COLUMN), not create_all —
    # see that function's docstring for why a plain model field alone isn't
    # enough to keep the existing DB file working after this change.
    foreign_fee: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency_id: Mapped[int] = mapped_column(ForeignKey("currencies.id", ondelete="RESTRICT"), nullable=False)
    rate_snapshot: Mapped[float] = mapped_column(Float, nullable=False)
    base_amount: Mapped[float] = mapped_column(Float, nullable=False)
    payer_id: Mapped[int] = mapped_column(ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    payment_method_id: Mapped[int | None] = mapped_column(
        ForeignKey("payment_methods.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    needs_split: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # "expense" (money flowing out, paid by payer_id) | "income" (money
    # flowing in, collected by payer_id — payer_id is reused as "receiver" for
    # income rows rather than adding a parallel column; see
    # services/settlement.py for how `type` flips the sign of this row's
    # contribution to the settlement math). Added via ensure_columns, same
    # caveat as foreign_fee above — existing rows backfill to "expense" via
    # the column's SQLite-level DEFAULT, preserving their original meaning.
    type: Mapped[str] = mapped_column(String(10), nullable=False, default="expense")
    # Optional receipt/reference photo, stored under backend/uploads/ (see
    # routers/uploads.py) — this column only holds the relative URL
    # ("/uploads/<uuid>.<ext>") returned by that upload endpoint, never the
    # binary itself. NULL for every expense without an attached image.
    # Added via ensure_columns, same caveat as foreign_fee/type above.
    image_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
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

    @property
    def effective_amount(self) -> float:
        """`amount` plus the foreign-transaction fee (if any) — the actual
        total this expense/income represents, and what gets converted to
        base_amount and split among shares. Not a mapped column (derived at
        read time), so it's always in sync with amount/foreign_fee."""
        return self.amount + (self.foreign_fee or 0.0)


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
