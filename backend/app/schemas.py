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


# ---------- User / TripAccess (see app/auth.py, routers/trips.py invite/join) ----------
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    name: str
    avatar_url: Optional[str] = None


class TripAccessOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    user_id: int
    # "owner" | "editor" | "viewer" | "contributor" — see models.TripAccess's
    # docstring for the full permission model and the "member" -> "editor"
    # rename history.
    role: str


class TripAccessRoleUpdate(BaseModel):
    """Body for PUT /api/trips/{trip_id}/access/{user_id} — owner-only role
    change. Deliberately excludes "owner" from the allowed values at the
    validation layer (not just an endpoint-level check): nobody may ever be
    promoted to owner through this endpoint, and the owner's own role can
    never be the target of this call either (see routers/trips.py
    update_trip_access_role's extra guard for that second rule, which this
    Literal alone can't express)."""
    role: Literal["editor", "viewer"]


class TripAccessUserOut(BaseModel):
    """One row of GET /api/trips/{trip_id}/access — a user joined with their
    role on this trip, for a future "誰能看到這趟行程" settings-page list.

    `is_me` tells the frontend whether THIS row is the calling user, straight
    from the backend's own require_trip_access-resolved identity — not
    something the frontend should re-derive by comparing e.g. NextAuth's
    session.user.email against `email` itself. That join breaks for a guest
    caller (no NextAuth session at all, so session.user.email is always
    undefined) even when the guest genuinely owns the trip, which used to
    make owner-only UI (like "產生邀請連結") silently disappear for guest
    owners. See PeopleSection.tsx's isOwner/myRole derivation.
    """
    user_id: int
    email: str
    name: str
    # Google avatar to show for this user, or None to fall back to the
    # initials/color-block avatar — same "linked, non-guest User with a
    # stored avatar_url" gating as models.Member.avatar_url (this row
    # already IS a User, joined directly in routers/trips.py
    # list_trip_access, so that gate is applied there rather than via a
    # computed property like Member's).
    avatar_url: Optional[str] = None
    # "owner" | "editor" | "viewer" | "contributor" — see models.TripAccess's
    # docstring.
    role: str
    is_me: bool = False


class TripInviteOut(BaseModel):
    """Response for POST /api/trips/{trip_id}/invite — the trip's stable
    invite code/link token (see models.Trip.invite_code)."""
    invite_code: str


class TripJoinIn(BaseModel):
    """Body for POST /api/trips/join."""
    invite_code: str = Field(min_length=1)
    # Optional: "I am this already-existing unlinked member" — lets a
    # Google-logged-in joiner explicitly pick which existing
    # member.user_id IS NULL row on this trip is really them, instead of
    # always getting a brand-new Member created (or relying on join_trip's
    # name-exact-match heuristic). Must reference a member that belongs to
    # THIS trip and isn't already linked — see join_trip's validation. When
    # omitted, join_trip falls back to its name-exact-match-then-create
    # behavior. Entirely IGNORED for a guest joiner (current_user.is_guest):
    # a guest always lands as the restricted "contributor" role and is never
    # linked to (or causes the creation of) a Member row at all — see
    # join_trip's docstring and models.TripAccess's "contributor" role notes
    # for why "which member is this guest" no longer applies.
    claim_member_id: Optional[int] = None


class UnlinkedMemberOut(BaseModel):
    """One row of GET /api/trips/join/preview's unlinked_members list — id +
    name of a Member with no linked account yet, for a Google joiner's
    optional TripJoinIn.claim_member_id pick. Not used by the guest join
    flow anymore (app/join/[code]/page.tsx) — see this round's "訪客也能是
    完整成員" simplification / TripJoinIn.claim_member_id's docstring: a
    guest never becomes (or claims) a Member."""
    id: int
    name: str


class TripJoinPreviewOut(BaseModel):
    """Response for GET /api/trips/join/preview?code=... — deliberately
    requires no login at all (see routers/trips.py join_preview), so a brand
    new visitor can see WHAT they're about to join before committing to a
    login method."""
    trip_name: str
    unlinked_members: list[UnlinkedMemberOut]


# ---------- Guest login / link-guest (see app/routers/auth.py) ----------
class GuestLoginIn(BaseModel):
    """Body for POST /api/auth/guest — optional. Lets a brand-new visitor
    pick their own display name up front (see app/login/page.tsx's "略過登入"
    flow) instead of always getting stuck with the generic "訪客" until they
    later rename via PUT /api/auth/me. Entirely optional (the whole point of
    guest login is zero-friction), so this endpoint also accepts no body at
    all — see routers/auth.py guest_login for the None/blank -> "訪客"
    fallback logic."""
    name: Optional[str] = Field(default=None, max_length=120)


class GuestLoginOut(BaseModel):
    """Response for POST /api/auth/guest — a freshly signed JWT for a
    brand-new guest User, in the same format Google-login-issued tokens use
    (see app/auth.py create_access_token). The frontend stores `token` in
    localStorage (never a cookie — see frontend/lib/authToken.ts) and sends
    it as this guest's Authorization bearer on every subsequent request,
    exactly like a normal logged-in user's token.

    No `recovery_code` anymore — this round's "訪客不該有任何帳號感"
    simplification removed the whole guest-recovery mechanism (see
    models.User.recovery_code's docstring); a guest identity is disposable
    and lives only as long as this browser keeps `token`."""
    token: str
    user: UserOut


class LinkGuestIn(BaseModel):
    """Body for POST /api/auth/link-guest — the guest-mode JWT the frontend
    previously stored in localStorage (see GuestLoginOut.token above),
    forwarded here so this (now real, Google-authenticated) request can look
    up which guest User to merge into current_user."""
    guest_token: str = Field(min_length=1)


class UserUpdate(BaseModel):
    """Body for PUT /api/auth/me — currently just a rename. Any logged-in
    user (guest or Google) may call this for themselves; the frontend only
    exposes a rename UI for guests (see components/UserMenu.tsx) since a
    Google user's name comes from their Google account itself, but the
    backend doesn't need to enforce that — there's no harm in a Google user
    renaming their in-app display name too, and gating it here would just be
    one more rule to keep in sync with the frontend for no real benefit."""
    name: str = Field(min_length=1, max_length=120)


# ---------- Member ----------
class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class MemberUpdate(BaseModel):
    """Body for PUT /api/members/{member_id}. `name` stays required (this
    endpoint used to be a pure rename, so every existing caller — e.g.
    PeopleSection.tsx's inline-rename — still sends only `name`); the five
    initial_exchange_* fields are new, all optional, and let the SAME
    endpoint also update this member's own "初始換匯" record (see
    models.Member's docstring — moved here from being trip-wide on Trip) in
    one call instead of a separate endpoint. Sending them as `None`
    explicitly clears that field (same "present -> write, absent -> leave
    the OTHER fields alone, but an explicit None still writes None"
    semantics every other *Update schema in this file already uses via
    model_dump(exclude_unset=True) at the call site)."""
    name: str = Field(min_length=1, max_length=80)
    initial_exchange_from_currency: Optional[str] = Field(default=None, max_length=10)
    initial_exchange_from_amount: Optional[float] = Field(default=None, ge=0)
    initial_exchange_to_currency: Optional[str] = Field(default=None, max_length=10)
    initial_exchange_to_amount: Optional[float] = Field(default=None, ge=0)
    initial_exchange_rate: Optional[float] = Field(default=None, gt=0)


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    trip_id: int
    name: str
    color: str
    order_index: int
    # Optional link to the User this split-participant corresponds to — see
    # models.Member.user_id's docstring for the three write sites
    # (create_trip / join_trip / link_guest). None for a plain split-only
    # Member with no app account. Lets the frontend show a "已連結帳號" badge
    # on members.py MembersSection-turned-PeopleSection rows that ARE a real
    # login identity, distinct from ones that are just a name.
    user_id: Optional[int] = None
    # Google avatar to show for this member instead of the initials/color-
    # block avatar — None whenever the linked User is a guest, has no
    # avatar_url stored, or there's no linked User at all (plain split-only
    # Member). Not a real DB column: computed at read time by
    # models.Member.avatar_url (see that property's docstring for the exact
    # gating), picked up automatically here via `from_attributes=True` since
    # this class validates directly off ORM Member instances/attributes.
    avatar_url: Optional[str] = None
    # Per-person "初始換匯" record — see models.Member's docstring for the
    # full field semantics (same shape/direction-convention as Trip's
    # now-superseded trip-wide version). PeopleSection.tsx reads/writes
    # these per member; SettlementPageClient.tsx's per-member budget-vs-spend
    # comparison uses initial_exchange_to_amount/_to_currency.
    initial_exchange_from_currency: Optional[str] = None
    initial_exchange_from_amount: Optional[float] = None
    initial_exchange_to_currency: Optional[str] = None
    initial_exchange_to_amount: Optional[float] = None
    initial_exchange_rate: Optional[float] = None


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
    # The CALLING user's own TripAccess.role for this trip ("owner" |
    # "editor" | "viewer") — same idea as TripSummaryOut.my_role below, but
    # for the single-trip detail payload (GET/PUT /api/trips/{trip_id} etc.).
    # Powers frontend viewer-role gating (hide/disable add/edit/delete
    # controls for a "viewer") without a second round-trip per page just to
    # learn the caller's own role. See routers/trips.py's _trip_detail_out.
    my_role: str = "owner"


class TripSummaryOut(TripOut):
    """Trip list card: adds aggregate total spend + member avatars."""
    members: list[MemberOut] = []
    total_base_amount: float = 0.0
    # The CALLING user's own TripAccess.role for this trip ("owner" |
    # "editor" | "viewer") — powers frontend/components/TripSidebar.tsx +
    # MobileTripDrawer.tsx's "只有 owner 才看得到刪除行程" gating, so the
    # frontend doesn't need a second /access round-trip per trip just to
    # know who's allowed to delete it.
    my_role: str = "editor"


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
