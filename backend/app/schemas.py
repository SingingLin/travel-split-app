"""Pydantic request/response schemas."""
# NOTE: imported as `date_type` (not bare `date`) and used as the type
# annotation everywhere below — never as `Optional[date] = None` with a field
# also literally named `date`. Pydantic v2 resolves annotations against the
# class's own namespace, and a field statement like
# `date: Optional[date] = None` binds the class attribute `date` (the field's
# default value) *before* the `date` type name in `Optional[date]` gets
# resolved, so the annotation silently collapses to `NoneType` and every
# request with that field set fails validation ("Input should be None").
# This is exactly what broke `ExpenseUpdate.date` (see routers/expenses.py
# update_expense — this was the root cause of "編輯支出按儲存失敗", confirmed
# via `ExpenseUpdate.model_fields['date'].annotation is NoneType`). Aliasing
# the import sidesteps the name collision entirely; kept consistent across
# every date-typed field in this file so it can't silently recur.
from datetime import date as date_type, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------- Member ----------
class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    name: str
    color: str
    order_index: int


# ---------- Currency ----------
class CurrencyCreate(BaseModel):
    code: str = Field(min_length=1, max_length=10)
    name: Optional[str] = ""
    rate_to_base: float = Field(gt=0)


class CurrencyUpdate(BaseModel):
    name: Optional[str] = None
    rate_to_base: Optional[float] = Field(default=None, gt=0)


class CurrencyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    code: str
    name: str
    rate_to_base: float
    is_base: bool


class CurrencyRatesBulkLookupOut(BaseModel):
    """Response for GET /api/currencies/rates?base=CODE.

    One-shot fetch of every rate the upstream API knows about, against an
    arbitrary base code (no trip required — see currencies.py
    lookup_currency_rates for why: CreateTripDialog needs this before a trip
    row exists), already converted to this project's rate_to_base direction
    (see currencies.py _fetch_rates_against for the inversion math). Frontend
    uses this to populate a currency-code dropdown without one API call per
    selection.
    """
    base_code: str
    rates: dict[str, float]


# ---------- Category ----------
class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: Optional[str] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    name: str
    color: str
    order_index: int


# ---------- PaymentMethod ----------
class PaymentMethodCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class PaymentMethodOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    name: str
    order_index: int


# ---------- Trip ----------
class TripCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    base_currency_code: str = Field(default="TWD", min_length=1, max_length=10)
    base_currency_name: Optional[str] = ""
    start_date: Optional[date_type] = None
    end_date: Optional[date_type] = None
    band_color: Optional[str] = "#0d9488"
    # "這次帶了多少錢去旅行" — optional, always in base_currency_code (see
    # models.Trip.initial_budget). Rarely set at creation time (the trip
    # usually doesn't have a budget figure yet), but accepted here too for
    # symmetry with TripUpdate/TripOut. Superseded by the initial_exchange_*
    # fields below — kept for backward compatibility, no longer written to by
    # the frontend (see TripInfoSection.tsx).
    initial_budget: Optional[float] = Field(default=None, ge=0)
    # "初始換匯" record — see models.Trip's docstring for the full field
    # semantics (direction convention, why the three numeric fields aren't
    # forced to mathematically match). Rarely set at creation time, same
    # rationale as initial_budget above.
    initial_exchange_from_currency: Optional[str] = Field(default=None, max_length=10)
    initial_exchange_from_amount: Optional[float] = Field(default=None, ge=0)
    initial_exchange_to_currency: Optional[str] = Field(default=None, max_length=10)
    initial_exchange_to_amount: Optional[float] = Field(default=None, ge=0)
    initial_exchange_rate: Optional[float] = Field(default=None, gt=0)


class TripUpdate(BaseModel):
    name: Optional[str] = None
    start_date: Optional[date_type] = None
    end_date: Optional[date_type] = None
    status: Optional[str] = None
    band_color: Optional[str] = None
    initial_budget: Optional[float] = Field(default=None, ge=0)
    initial_exchange_from_currency: Optional[str] = Field(default=None, max_length=10)
    initial_exchange_from_amount: Optional[float] = Field(default=None, ge=0)
    initial_exchange_to_currency: Optional[str] = Field(default=None, max_length=10)
    initial_exchange_to_amount: Optional[float] = Field(default=None, ge=0)
    initial_exchange_rate: Optional[float] = Field(default=None, gt=0)


class TripOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    base_currency_code: str
    start_date: Optional[date_type]
    end_date: Optional[date_type]
    status: str
    band_color: str
    initial_budget: Optional[float] = None
    initial_exchange_from_currency: Optional[str] = None
    initial_exchange_from_amount: Optional[float] = None
    initial_exchange_to_currency: Optional[str] = None
    initial_exchange_to_amount: Optional[float] = None
    initial_exchange_rate: Optional[float] = None
    created_at: datetime


class TripDetailOut(TripOut):
    members: list[MemberOut] = []
    currencies: list[CurrencyOut] = []
    categories: list[CategoryOut] = []
    payment_methods: list[PaymentMethodOut] = []


class TripSummaryOut(TripOut):
    """Trip list card: adds aggregate total spend + member avatars."""
    members: list[MemberOut] = []
    total_base_amount: float = 0.0


# ---------- Expense / ExpenseShare ----------
class ExpenseShareIn(BaseModel):
    member_id: int
    amount: float = Field(ge=0)
    is_settled: bool = False


class ExpenseShareOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    member_id: int
    amount: float
    base_amount: float
    is_settled: bool


class ExpenseCreate(BaseModel):
    date: date_type
    category_id: Optional[int] = None
    # Item name is optional — a blank/omitted name is backfilled server-side
    # to a type-appropriate default ("支出"/"收入"; see
    # routers/expenses.py `_default_name`), not rejected. Still capped at 160
    # chars when provided (same limit ExpenseOut/the DB column impose).
    name: Optional[str] = Field(default=None, max_length=160)
    amount: float = Field(gt=0)
    # Optional "海外手續費" (foreign transaction fee) — only meaningful when
    # payment_method is a credit card, but not enforced here (see
    # models.Expense.foreign_fee). Added to `amount` to get
    # effective_amount, which is what actually gets converted to base_amount
    # and split among shares (see routers/expenses.py).
    foreign_fee: Optional[float] = Field(default=None, ge=0)
    currency_id: int
    # Optional manual override of the rate used for this expense's
    # rate_snapshot/base_amount, in place of the currency's current
    # rate_to_base. Present -> use this value; absent/None -> fall back to
    # currency.rate_to_base (unchanged old behavior). See routers/expenses.py.
    rate_override: Optional[float] = Field(default=None, gt=0)
    payer_id: int
    payment_method_id: Optional[int] = None
    note: Optional[str] = None
    needs_split: bool = False
    shares: list[ExpenseShareIn] = []
    # "expense" (money out) | "income" (money in) — see models.Expense.type.
    type: Literal["expense", "income"] = "expense"
    # Optional receipt/reference photo URL, as returned by
    # POST /api/uploads/expense-image (e.g. "/uploads/xxxxx.jpg") — see
    # models.Expense.image_url. Not validated as a real URL here; it's always
    # frontend-supplied from that upload response, never typed by hand.
    image_url: Optional[str] = None


class ExpenseUpdate(BaseModel):
    date: Optional[date_type] = None
    category_id: Optional[int] = None
    name: Optional[str] = Field(default=None, max_length=160)
    amount: Optional[float] = Field(default=None, gt=0)
    foreign_fee: Optional[float] = Field(default=None, ge=0)
    currency_id: Optional[int] = None
    rate_override: Optional[float] = Field(default=None, gt=0)
    payer_id: Optional[int] = None
    payment_method_id: Optional[int] = None
    note: Optional[str] = None
    needs_split: Optional[bool] = None
    shares: Optional[list[ExpenseShareIn]] = None
    type: Optional[Literal["expense", "income"]] = None
    image_url: Optional[str] = None


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    date: date_type
    category_id: Optional[int]
    name: str
    amount: float
    foreign_fee: Optional[float]
    effective_amount: float
    currency_id: int
    rate_snapshot: float
    base_amount: float
    payer_id: int
    payment_method_id: Optional[int]
    note: Optional[str]
    needs_split: bool
    type: str
    image_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    shares: list[ExpenseShareOut] = []


# ---------- Settlement ----------
class MemberSettlementOut(BaseModel):
    member_id: int
    name: str
    color: str
    total_owed: float  # 應分攤總額
    total_paid: float  # 實際支付總額
    net: float  # paid - owed ; positive = 應收, negative = 應付


class DebtCell(BaseModel):
    debtor_id: int
    creditor_id: int
    amount: float


class TransferSuggestion(BaseModel):
    from_member_id: int
    to_member_id: int
    amount: float


class CategoryBreakdownItem(BaseModel):
    """One slice of the settlement page's "依分類花費比例" pie chart —
    amount/percentage of type="expense" spend in this category, in the same
    currency as the SettlementOut it's attached to. `category_id` is None
    for the synthetic "未分類" bucket (expenses with no category_id set);
    `color` always comes straight from models.Category.color (or the fixed
    slate-400 fallback for 未分類) — never re-derived on the frontend, so it
    stays pixel-identical to the category chips used elsewhere in the app."""
    category_id: Optional[int]
    name: str
    color: str
    amount: float
    percentage: float  # 0-100, of this SettlementOut's trip_total_spend


class SettlementOut(BaseModel):
    currency_code: str
    members: list[MemberSettlementOut]
    matrix: list[DebtCell]  # netted pairwise debts (positive amounts only)
    raw_relationship_count: int  # M in "已簡化為 N 筆轉帳（原始 M 組欠款關係）"
    suggested_transfers: list[TransferSuggestion]
    # Sum of every type="expense" amount in this currency (income rows
    # excluded, same signed-total convention as routers/trips.py's trip-list
    # card and ExpensesPageClient's "合計") — should always equal
    # sum(m.total_owed for m in members) by construction; see
    # routers/settlement.py for how it's computed.
    trip_total_spend: float = 0.0
    category_breakdown: list[CategoryBreakdownItem] = []


class NativeSettlementOut(BaseModel):
    """Response for GET /api/trips/{trip_id}/settlement/by-currency — the
    "依原幣別分開結算" mode: one independent SettlementOut per currency the
    trip actually has expenses in, computed from each expense's own native
    amount (no cross-currency conversion at all, unlike the single-currency
    GET /api/trips/{trip_id}/settlement above). Only currencies with at
    least one expense appear here."""
    results: list[SettlementOut]
