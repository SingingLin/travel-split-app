"""Pydantic request/response schemas."""
from datetime import date, datetime
from typing import Optional

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
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    band_color: Optional[str] = "#0d9488"


class TripUpdate(BaseModel):
    name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[str] = None
    band_color: Optional[str] = None


class TripOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    base_currency_code: str
    start_date: Optional[date]
    end_date: Optional[date]
    status: str
    band_color: str
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
    date: date
    category_id: Optional[int] = None
    name: str = Field(min_length=1, max_length=160)
    amount: float = Field(gt=0)
    currency_id: int
    payer_id: int
    payment_method_id: Optional[int] = None
    note: Optional[str] = None
    needs_split: bool = False
    shares: list[ExpenseShareIn] = []


class ExpenseUpdate(BaseModel):
    date: Optional[date] = None
    category_id: Optional[int] = None
    name: Optional[str] = None
    amount: Optional[float] = Field(default=None, gt=0)
    currency_id: Optional[int] = None
    payer_id: Optional[int] = None
    payment_method_id: Optional[int] = None
    note: Optional[str] = None
    needs_split: Optional[bool] = None
    shares: Optional[list[ExpenseShareIn]] = None


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    date: date
    category_id: Optional[int]
    name: str
    amount: float
    currency_id: int
    rate_snapshot: float
    base_amount: float
    payer_id: int
    payment_method_id: Optional[int]
    note: Optional[str]
    needs_split: bool
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


class SettlementOut(BaseModel):
    currency_code: str
    members: list[MemberSettlementOut]
    matrix: list[DebtCell]  # netted pairwise debts (positive amounts only)
    raw_relationship_count: int  # M in "已簡化為 N 筆轉帳（原始 M 組欠款關係）"
    suggested_transfers: list[TransferSuggestion]
