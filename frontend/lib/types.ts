// Mirrors backend/app/schemas.py — keep in sync with the FastAPI response models.

export interface Member {
  id: number;
  trip_id: number;
  name: string;
  color: string;
  order_index: number;
  /** Optional link to the User (login identity) this split-participant
   * corresponds to — null for a "pure" split-only Member with no app
   * account. See backend/app/models.py Member.user_id's docstring for the
   * three write sites (create_trip / join_trip / link-guest) that set
   * this. Powers components/settings/PeopleSection.tsx's "已連結帳號"
   * badge. */
  user_id: number | null;
  /** Google avatar to show instead of the initials/color-block avatar — null
   * whenever this member has no linked User, that User is a guest, or that
   * User has no avatar_url stored. Computed server-side (see
   * backend/app/models.py Member.avatar_url), never derived on the
   * frontend. See components/Avatar.tsx. */
  avatar_url: string | null;
  /** Per-person "初始換匯" record — same shape/direction-convention as the
   * now-superseded trip-wide Trip.initial_exchange_* fields (see
   * backend/app/models.py Member's docstring): this member exchanged
   * initial_exchange_from_amount units of initial_exchange_from_currency
   * into initial_exchange_to_amount units of initial_exchange_to_currency,
   * at initial_exchange_rate. All five independently nullable/editable — see
   * components/settings/PeopleSection.tsx's per-member panel and
   * components/SettlementPageClient.tsx's per-member budget-vs-spend card. */
  initial_exchange_from_currency: string | null;
  initial_exchange_from_amount: number | null;
  initial_exchange_to_currency: string | null;
  initial_exchange_to_amount: number | null;
  initial_exchange_rate: number | null;
}

export interface Currency {
  id: number;
  trip_id: number;
  code: string;
  name: string;
  rate_to_base: number;
  is_base: boolean;
}

export interface Category {
  id: number;
  trip_id: number;
  name: string;
  color: string;
  order_index: number;
}

export interface PaymentMethod {
  id: number;
  trip_id: number;
  name: string;
  order_index: number;
}

export interface Trip {
  id: number;
  name: string;
  base_currency_code: string;
  start_date: string | null;
  end_date: string | null;
  status: "active" | "settled" | string;
  band_color: string;
  /** "這次帶了多少錢去旅行" — always denominated in base_currency_code, null
   * when never filled in. Superseded by the initial_exchange_* fields below;
   * kept for backward compatibility but no longer written to by the
   * frontend. See TripInfoSection.tsx / SettlementPageClient.tsx. */
  initial_budget: number | null;
  /** "初始換匯" record — the user exchanged initial_exchange_from_amount
   * units of initial_exchange_from_currency into initial_exchange_to_amount
   * units of initial_exchange_to_currency, at initial_exchange_rate (their
   * actual historical rate, independent of this trip's live Currency
   * rate_to_base — never auto-overwritten once saved). Direction convention
   * matches rate_to_base throughout this project: "1 unit of
   * initial_exchange_to_currency = initial_exchange_rate units of
   * initial_exchange_from_currency". All five fields are independently
   * nullable/editable — see TripInfoSection.tsx for the "fill any two,
   * suggest the third" UI and SettlementPageClient.tsx for how
   * initial_exchange_to_amount feeds the budget-vs-spend comparison. */
  initial_exchange_from_currency: string | null;
  initial_exchange_from_amount: number | null;
  initial_exchange_to_currency: string | null;
  initial_exchange_to_amount: number | null;
  initial_exchange_rate: number | null;
  created_at: string;
}

/** "owner" | "editor" | "viewer" | "contributor" — see backend/app/models.py
 * TripAccess's docstring for the full permission model (owner: full control
 * incl. irreversible/owner-only actions; editor: can view/edit everything
 * else; viewer: read-only, every write is rejected server-side by
 * require_edit_access; contributor: the guest-mode restricted role — may
 * ONLY create a new expense, everything else 403s the same as viewer, see
 * require_expense_create_access). Used both for TripAccessUser.role (any
 * user's role) and TripDetail/TripSummary.my_role (the CALLING user's own
 * role). */
export type TripRole = "owner" | "editor" | "viewer" | "contributor" | string;

export interface TripDetail extends Trip {
  members: Member[];
  currencies: Currency[];
  categories: Category[];
  payment_methods: PaymentMethod[];
  /** The CALLING user's own role on THIS trip — see TripRole. Powers
   * viewer-role UI gating (hide/disable add/edit/delete controls) across
   * ExpensesPageClient.tsx and the settings-page sections, without a
   * separate GET /access round-trip just to learn it. See backend
   * schemas.TripDetailOut.my_role / routers/trips.py's _trip_detail_out. */
  my_role: TripRole;
}

export interface TripSummary extends Trip {
  members: Member[];
  total_base_amount: number;
  /** Calling user's own role on this trip — see TripRole. Powers
   * TripSidebar.tsx / MobileTripDrawer.tsx's owner-only "刪除行程" entry. */
  my_role: TripRole;
}

export interface ExpenseShare {
  id: number;
  member_id: number;
  amount: number;
  base_amount: number;
  is_settled: boolean;
}

export interface ExpenseShareInput {
  member_id: number;
  amount: number;
  is_settled: boolean;
}

export type ExpenseType = "expense" | "income";

export interface Expense {
  id: number;
  trip_id: number;
  date: string;
  category_id: number | null;
  name: string;
  amount: number;
  foreign_fee: number | null;
  effective_amount: number;
  currency_id: number;
  rate_snapshot: number;
  base_amount: number;
  payer_id: number;
  payment_method_id: number | null;
  note: string | null;
  needs_split: boolean;
  type: ExpenseType;
  /** Receipt/reference photo URL, e.g. "/uploads/xxxxx.jpg" — served by the
   * backend's static /uploads mount. Null when no image was attached. */
  image_url: string | null;
  created_at: string;
  updated_at: string;
  shares: ExpenseShare[];
}

export interface ExpenseInput {
  date: string;
  category_id: number | null;
  name: string;
  amount: number;
  foreign_fee: number | null;
  currency_id: number;
  rate_override?: number | null;
  payer_id: number;
  payment_method_id: number | null;
  note: string | null;
  needs_split: boolean;
  shares: ExpenseShareInput[];
  type: ExpenseType;
  image_url?: string | null;
}

export interface MemberSettlement {
  member_id: number;
  name: string;
  color: string;
  total_owed: number;
  total_paid: number;
  net: number;
}

export interface DebtCell {
  debtor_id: number;
  creditor_id: number;
  amount: number;
}

export interface TransferSuggestion {
  from_member_id: number;
  to_member_id: number;
  amount: number;
}

export interface CategoryBreakdownItem {
  category_id: number | null;
  name: string;
  color: string;
  amount: number;
  percentage: number;
}

export interface Settlement {
  currency_code: string;
  members: MemberSettlement[];
  matrix: DebtCell[];
  raw_relationship_count: number;
  suggested_transfers: TransferSuggestion[];
  /** Sum of type="expense" amounts, net of income (income subtracts) — same
   * signed convention as the trip-list card / ExpensesPageClient's "合計".
   * Equals sum(members[].total_owed) by construction. */
  trip_total_spend: number;
  /** "依分類花費比例" pie chart data — type="expense" only, income excluded
   * entirely (not netted). Colors come straight from the backend's Category
   * rows, never re-derived on the frontend. */
  category_breakdown: CategoryBreakdownItem[];
}

/** Response shape for GET /api/trips/{id}/settlement/by-currency — one
 * independent Settlement per currency the trip actually has expenses in,
 * each computed from native (unconverted) amounts. See
 * SettlementPageClient.tsx's "依原幣別分開結算" mode. */
export interface NativeSettlement {
  results: Settlement[];
}

/** One row of GET /api/trips/{id}/access — mirrors backend
 * schemas.TripAccessUserOut. Powers PeopleSection.tsx's merged 成員/共用行程
 * list; `role` is TripRole (backend/app/models.py TripAccess).
 * `is_me` is set by the backend from the caller's own resolved TripAccess
 * row — use it (not a session/email comparison) to find "my" row and role,
 * since a guest caller has no NextAuth session to compare against at all. */
export interface TripAccessUser {
  user_id: number;
  email: string;
  name: string;
  /** Same "linked, non-guest, has a stored avatar" gating as Member.
   * avatar_url above — see components/Avatar.tsx. */
  avatar_url: string | null;
  role: TripRole;
  is_me: boolean;
}

/** Mirrors backend schemas.UserOut — the `user` field of
 * POST /api/auth/guest's response. See lib/api.ts guestLogin. */
export interface UserOut {
  id: number;
  email: string;
  name: string;
  avatar_url: string | null;
}
