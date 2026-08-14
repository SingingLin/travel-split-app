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
    # Stable per-trip invite token used by POST /{trip_id}/invite and
    # POST /trips/join (see routers/trips.py and app/auth.py's TripAccess-
    # based permission model). NULL until the trip's owner first calls
    # /invite — generated once (secrets.token_urlsafe), then reused forever
    # (repeated /invite calls return the same code rather than rotating it).
    # Added via database.ensure_columns (SQLite ADD COLUMN), same caveat as
    # initial_budget above; its UNIQUE index is added separately via
    # database.ensure_unique_index since SQLite's ADD COLUMN can't attach a
    # UNIQUE constraint inline (see that function's docstring).
    invite_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
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
    # ORM-level cascade (not just the DB-level ondelete="CASCADE" on
    # TripAccess.trip_id below) so deleting a trip via the ORM (db.delete
    # (trip); see routers/trips.py delete_trip) always cleans up its
    # TripAccess rows even on a connection/engine that doesn't have SQLite's
    # `PRAGMA foreign_keys=ON` enabled (e.g. a test engine built without
    # app.database's connect event listener) — matches every other
    # relationship on this model. Without this, an orphaned TripAccess row
    # from a deleted trip can silently reattach itself to a *different*,
    # later-created trip that happens to reuse the same integer id (SQLite
    # reuses a table's lowest free rowid once it's empty) — a real
    # permission-leak footgun this project doesn't want, not just a test
    # artifact.
    trip_accesses: Mapped[list["TripAccess"]] = relationship(
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
    # Optional link to the User (login identity) this split-participant
    # corresponds to — NULL for a "pure" split-only Member with no app
    # account at all (e.g. tracking a friend's cash contributions who never
    # logs in; that ability is the whole reason Member and User/TripAccess
    # stay separate tables, see routers/trips.py join_trip and this column's
    # write sites below). Set automatically, never picked by the user
    # directly:
    #   - create_trip (routers/trips.py): the creator's auto-added Member
    #     gets user_id=current_user.id.
    #   - join_trip (routers/trips.py): redeeming an invite code auto-links
    #     (or auto-creates) a Member with user_id=current_user.id, so
    #     whoever joins via a shared link is automatically also a split
    #     participant without the owner manually adding them.
    #   - link_guest (routers/auth.py): repoints every Member.user_id that
    #     pointed at the guest User over to the real Google User, mirroring
    #     what it already does for TripAccess.user_id, so a guest's split-
    #     member identity carries over when they upgrade to a real login.
    # ondelete="SET NULL" (not CASCADE): deleting a User account should not
    # delete the Member/its expense history — it should just fall back to
    # being a plain unlinked name, same as if it had never been linked.
    # Added via database.ensure_columns (SQLite ADD COLUMN), same caveat as
    # every other ensure_columns-backfilled column in this file — see
    # main.py for the actual ALTER TABLE call.
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    # Per-person "初始換匯" record — same five fields/semantics as
    # Trip.initial_exchange_* (see models.Trip's docstring for the full field
    # meaning, direction convention, and "independently editable, not
    # force-matched" design), just scoped to ONE member instead of the whole
    # trip: each person may have exchanged a different amount at a different
    # rate, so this now lives per-Member rather than once per-Trip.
    # Trip.initial_exchange_* itself is left in place, unused, per this
    # project's no-migration-tooling policy (see Trip's docstring) —
    # frontend/components/settings/PeopleSection.tsx is what reads/writes
    # these now (moved from TripInfoSection.tsx), and
    # SettlementPageClient.tsx's budget-vs-spend comparison is now per-member
    # (MemberSummaryCard), not a single trip-wide bar. Works for a member
    # with no linked User account too — "how much cash this person brought"
    # has nothing to do with whether they've ever logged into the app.
    # Added via database.ensure_columns, same caveat as user_id above.
    initial_exchange_from_currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    initial_exchange_from_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    initial_exchange_to_currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    initial_exchange_to_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    initial_exchange_rate: Mapped[float | None] = mapped_column(Float, nullable=True)

    trip: Mapped["Trip"] = relationship(back_populates="members")
    user: Mapped["User | None"] = relationship()

    @property
    def avatar_url(self) -> str | None:
        """Google avatar to show for this split-participant, or None to fall
        back to the initials/color-block avatar (see schemas.MemberOut /
        frontend/components/Avatar.tsx). Deliberately gated here, server-side
        (not just "whatever User.avatar_url happens to hold"), on BOTH
        conditions the task requires:
          - `user` is linked at all (a plain unlinked split-only Member has
            no account, let alone an avatar).
          - `user.is_guest` is False — a guest's `avatar_url` is always None
            anyway (guests never go through Google login, see
            app/auth.py get_current_user), but the explicit check keeps this
            correct even if a guest row somehow ever got one written to it.
        Not a mapped column — computed at read time from the `user`
        relationship, so it's always in sync with whatever the linked User's
        avatar_url currently is (kept fresh on every Google sign-in, see
        get_current_user). Pydantic's `from_attributes=True` (schemas.
        MemberOut) picks this up exactly like any other attribute, so every
        call site that returns a Member (either via MemberOut.model_validate
        or a raw ORM object through `response_model=MemberOut`) gets this for
        free with no per-call-site wiring.
        """
        if self.user is not None and not self.user.is_guest and self.user.avatar_url:
            return self.user.avatar_url
        return None


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


class User(Base):
    """An authenticated app user, upserted on first request from the
    Authorization JWT's `email` claim (see app/auth.py get_current_user) —
    this round doesn't do real Google login, but the JWT's payload shape is
    designed to match what a future Google-login-issued token will carry.
    Brand-new table, so plain Base.metadata.create_all() (main.py) is enough
    to create it; no ensure_columns() backfill needed.

    is_guest: True for a User row created by POST /api/auth/guest (no Google
    login at all — see routers/auth.py) instead of a real Google identity.
    A guest User's `email` is never actually theirs — it's a synthetic,
    guaranteed-unique placeholder ("guest-<uuid>@guest.local") so it can
    still satisfy this table's `email` UNIQUE NOT NULL constraint without
    reusing the same "no email" sentinel across every guest. Guest users are
    meant to be short-lived: POST /api/auth/link-guest transfers every
    TripAccess row a guest owns to a real (Google-logged-in) User and then
    deletes the guest User row outright — see that endpoint's docstring for
    the full transfer/cleanup flow. Added via database.ensure_columns
    (SQLite ADD COLUMN), same caveat as e.g. Expense.foreign_fee above:
    existing User rows (all real Google logins from before this column
    existed) backfill to `is_guest=False` via the column's SQLite-level
    DEFAULT, which is exactly what they should be.
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_guest: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # RETIRED: this round's "訪客不該有任何帳號感" simplification removed the
    # guest "找回代碼" feature entirely (POST /api/auth/guest/recover is gone,
    # guest_login no longer generates/writes a value here) — a guest is now a
    # pure, disposable per-browser identity with no recovery mechanism at
    # all, on purpose (see routers/auth.py guest_login's docstring). This
    # column is kept, per this project's "舊欄位保留閒置" convention, purely
    # so existing rows (and this table's shape) don't need a migration; it is
    # never written to for any NEW row and should be treated as dead data —
    # always NULL for a guest created after this round, and for every real
    # Google-login User as before. Added via database.ensure_columns (SQLite
    # ADD COLUMN); its UNIQUE index (database.ensure_unique_index, see
    # main.py) is likewise left in place but inert.
    recovery_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TripAccess(Base):
    """Join table granting a User permission to view/edit one Trip's shared
    data — the core of the "same trip, same data, multiple invited people"
    model (see app/auth.py require_trip_access/require_edit_access/
    require_expense_create_access, routers/trips.py invite/join endpoints).
    `role` is one of four values: "owner" (the trip's creator, or whoever a
    future round transfers ownership to — the only role that may delete the
    trip, revoke another user's access, generate an invite link, merge
    members, or change someone else's role), "editor" (can view and edit
    everything else — add/edit/delete expenses, members, currencies,
    categories, payment methods, trip info), "viewer" (read-only — every GET
    works, every write is rejected by app/auth.py's require_edit_access with
    a 403), or "contributor" (the guest-mode restricted role — see below).

    "contributor" — added for the "訪客也能是完整成員" simplification round:
    a guest (User.is_guest True) who joins a trip via an invite link always
    gets this role, never "editor" (see routers/trips.py join_trip). A
    contributor may ONLY create new expenses (require_expense_create_access,
    the one carve-out from require_edit_access) and read everything a viewer
    can read (require_trip_access) — every other write (edit/delete an
    expense, members/currencies/categories/payment-methods/trip-info,
    invite-link generation, access management) is rejected by
    require_edit_access exactly like "viewer" is. This role is never
    assigned manually — PUT /api/trips/{trip_id}/access/{user_id}'s
    TripAccessRoleUpdate schema only allows switching between "editor" and
    "viewer" (see schemas.py), so the only way a TripAccess row ends up
    "contributor" is join_trip's is_guest branch. A contributor is
    deliberately never linked to (or auto-creates) a Member row — a guest
    can fill in a Member-authored expense's payer/split-participant fields by
    picking among existing Members, but is never themselves selectable as
    one (see this round's task spec / models.Member's docstring: the only
    two ways to become a Member are a real Google login or the trip owner
    manually typing in a plain name).

    Historical note: this column used to only have two values, "owner" and
    "member" ("member" meaning exactly what "editor" means now — real-user
    feedback was that "member"/"協作者" read as vague, not that its
    permissions needed to change). Every pre-existing "member" row was
    content-migrated (not schema-migrated — see database.py
    backfill_role_member_to_editor, called once at startup in main.py) to
    "editor" with no change in actual behavior for those users. New rows
    are always written with an explicit role by every call site (create_trip
    -> "owner", join_trip -> "editor" for a Google user / "contributor" for
    a guest) — the "editor" column default below only matters for defensive
    completeness (e.g. a future raw INSERT that omits the column), not any
    real code path today.
    Brand-new table, same create_all() note as User above."""
    __tablename__ = "trip_access"
    __table_args__ = (UniqueConstraint("trip_id", "user_id", name="uq_trip_access_trip_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # "owner" | "editor" | "viewer" | "contributor" — see this class's docstring.
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="editor")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    trip: Mapped["Trip"] = relationship(back_populates="trip_accesses")
    user: Mapped["User"] = relationship()
