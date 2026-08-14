import type {
  Category,
  Currency,
  Expense,
  ExpenseInput,
  Member,
  NativeSettlement,
  PaymentMethod,
  Settlement,
  Trip,
  TripAccessUser,
  TripDetail,
  TripSummary,
  UserOut,
} from "./types";
import { currentBackendToken } from "./authToken";

// Exported so callers can resolve backend-relative URLs the API returns
// (e.g. Expense.image_url = "/uploads/xxxxx.jpg") into a full <img src> —
// those are relative to the FastAPI backend, not this Next.js frontend, so
// they'd otherwise resolve against the wrong origin.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // `request()` is a plain function with no React context of its own, so it
  // can't call useSession() directly — currentBackendToken is a live-binding
  // module export that components/SessionProviderWrapper.tsx keeps synced
  // with the signed-in user's session.backendToken (see lib/authToken.ts).
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (currentBackendToken) headers.Authorization = `Bearer ${currentBackendToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });
  if (res.status === 401) {
    // Token missing/expired/invalid — backend/app/auth.py's get_current_user
    // rejects every such case as a 401 without distinguishing which. Not a
    // React component, so no router hook available here; a hard navigation
    // is also the simplest way to guarantee any stale in-memory app state
    // gets dropped on the way to re-login.
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(401, "登入已過期或無效，請重新登入");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      // ignore parse failure, keep statusText
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------- Trips ----------
export const listTrips = () => request<TripSummary[]>("/api/trips");
export const getTrip = (tripId: number) => request<TripDetail>(`/api/trips/${tripId}`);
export const createTrip = (data: {
  name: string;
  base_currency_code: string;
  base_currency_name?: string;
  start_date?: string | null;
  end_date?: string | null;
  band_color?: string;
  initial_budget?: number | null;
  initial_exchange_from_currency?: string | null;
  initial_exchange_from_amount?: number | null;
  initial_exchange_to_currency?: string | null;
  initial_exchange_to_amount?: number | null;
  initial_exchange_rate?: number | null;
}) => request<TripDetail>("/api/trips", { method: "POST", body: JSON.stringify(data) });
export const updateTrip = (tripId: number, data: Partial<Trip>) =>
  request<TripDetail>(`/api/trips/${tripId}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteTrip = (tripId: number) =>
  request<void>(`/api/trips/${tripId}`, { method: "DELETE" });
export const changeBaseCurrency = (tripId: number, currencyId: number) =>
  request<TripDetail>(`/api/trips/${tripId}/base-currency?currency_id=${currencyId}`, { method: "PUT" });

// ---------- Trip access / invite (multi-person trip sharing) ----------
/** Owner-only. Idempotent on the backend — repeated calls return the SAME
 * invite_code once one exists, not a rotated one. See
 * backend/app/routers/trips.py create_invite. */
export const createInvite = (tripId: number) =>
  request<{ invite_code: string }>(`/api/trips/${tripId}/invite`, { method: "POST" });
/** Redeems an invite code, granting the current (already-logged-in) user
 * access and returning the trip — "editor" for a Google-logged-in user,
 * "contributor" (this round's "訪客也能是完整成員" simplification — may only
 * create new expenses) for a guest. 404s (via ApiError) on an invalid/
 * expired code. `claimMemberId` (optional) lets a Google joiner explicitly
 * pick which existing unlinked Member on this trip is really them, instead
 * of always getting a brand-new Member created — see
 * backend/app/routers/trips.py join_trip / app/join/[code]/page.tsx.
 * IGNORED entirely for a guest joiner: a guest is never linked to (or
 * causes the creation of) a Member row. */
export const joinTrip = (inviteCode: string, claimMemberId?: number) =>
  request<TripDetail>("/api/trips/join", {
    method: "POST",
    body: JSON.stringify({ invite_code: inviteCode, claim_member_id: claimMemberId ?? null }),
  });
/** Unauthenticated preview of what an invite code leads to — no login
 * required at all, so app/join/[code]/page.tsx can show "你要加入『{行程
 * 名稱}』" before committing to a login method. `unlinked_members` is kept
 * for a Google joiner's optional claim_member_id pick — the guest join flow
 * doesn't use it anymore (see joinTrip's docstring above). 404s on an
 * invalid code. */
export const previewJoin = (inviteCode: string) =>
  request<{ trip_name: string; unlinked_members: { id: number; name: string }[] }>(
    `/api/trips/join/preview?code=${encodeURIComponent(inviteCode)}`
  );
export const getTripAccess = (tripId: number) =>
  request<TripAccessUser[]>(`/api/trips/${tripId}/access`);
/** Owner-only; the backend also rejects removing yourself (400) even if
 * you're the owner. Also deletes this user's linked split-Member on this
 * trip (if any) in the same backend transaction — "移除存取權" and "刪除分帳
 * 成員" are no longer two separate actions for a linked account, see
 * backend/app/routers/trips.py remove_trip_access's docstring. */
export const removeTripAccess = (tripId: number, userId: number) =>
  request<void>(`/api/trips/${tripId}/access/${userId}`, { method: "DELETE" });
/** Owner-only; switches another user's role between "editor" and "viewer".
 * Can never target "owner" (rejected server-side, see
 * backend/app/schemas.py TripAccessRoleUpdate) and can never be called on
 * the caller's own row or another owner's row. See
 * backend/app/routers/trips.py update_trip_access_role. */
export const updateTripAccessRole = (tripId: number, userId: number, role: "editor" | "viewer") =>
  request<{ id: number; trip_id: number; user_id: number; role: string }>(
    `/api/trips/${tripId}/access/${userId}`,
    { method: "PUT", body: JSON.stringify({ role }) }
  );

// ---------- Guest login / link-guest / rename (see backend app/routers/auth.py) ----------
/** No Authorization header needed (guest login IS the "not logged in yet"
 * path) — request() just won't attach one since currentBackendToken is null
 * at this point for a brand-new visitor. Only ever called from
 * app/join/[code]/page.tsx's guest flow — a guest identity can only be
 * created by redeeming an invite link (this round's "訪客也能是完整成員"
 * simplification removed the standalone "略過登入，先用訪客身分開始" entry
 * point app/login/page.tsx used to offer). This round's "訪客不該有任何帳號
 * 感" simplification further removed the `name` argument entirely on the
 * frontend side — every guest is just "訪客" now, no naming step, no
 * recovery code in the response either (see backend schemas.GuestLoginOut's
 * docstring for what got removed there). The backend endpoint itself still
 * technically accepts an optional name (kept for backend flexibility), this
 * frontend caller just never sends one anymore. */
export const guestLogin = () =>
  request<{ token: string; user: UserOut }>("/api/auth/guest", {
    method: "POST",
    body: JSON.stringify({}),
  });
/** Requires the CALLER to already be logged in via a real NextAuth (Google)
 * session — `guestToken` is the guest-mode JWT being folded in, not this
 * request's own auth. See components/GuestLinkHandler.tsx. */
export const linkGuest = (guestToken: string) =>
  request<TripSummary[]>("/api/auth/link-guest", {
    method: "POST",
    body: JSON.stringify({ guest_token: guestToken }),
  });
/** Renames the CALLING user's own account (backend PUT /api/auth/me) — any
 * logged-in identity may call this. Not currently called from anywhere in
 * this frontend: this round's "訪客不該有任何帳號感" simplification removed
 * components/UserMenu.tsx's guest rename UI (the only caller), since a
 * guest no longer has a name worth managing at all (always "訪客") — kept
 * here since the backend endpoint itself is unchanged and still generically
 * useful. */
export const updateMe = (name: string) =>
  request<UserOut>("/api/auth/me", { method: "PUT", body: JSON.stringify({ name }) });

// ---------- Members ----------
export const createMember = (tripId: number, name: string) =>
  request<Member>(`/api/trips/${tripId}/members`, { method: "POST", body: JSON.stringify({ name }) });
/** `exchange` optionally updates this member's own per-person "初始換匯"
 * record in the same call (see backend schemas.MemberUpdate) — omit it for a
 * plain rename (every pre-existing caller). See
 * components/settings/PeopleSection.tsx's per-member exchange panel. */
export const updateMember = (
  memberId: number,
  name: string,
  exchange?: {
    initial_exchange_from_currency?: string | null;
    initial_exchange_from_amount?: number | null;
    initial_exchange_to_currency?: string | null;
    initial_exchange_to_amount?: number | null;
    initial_exchange_rate?: number | null;
  }
) =>
  request<Member>(`/api/members/${memberId}`, {
    method: "PUT",
    body: JSON.stringify({ name, ...(exchange ?? {}) }),
  });
export const deleteMember = (memberId: number) =>
  request<void>(`/api/members/${memberId}`, { method: "DELETE" });
/** Owner-only. Folds `memberId` into `targetMemberId` (every expense/share
 * reassigned, `memberId` deleted) — see backend/app/routers/trips.py
 * merge_member for the full merge-direction rule and conflicting-share
 * handling. Returns the (updated) target Member. See
 * components/settings/PeopleSection.tsx's "合併" action. */
export const mergeMember = (tripId: number, memberId: number, targetMemberId: number) =>
  request<Member>(`/api/trips/${tripId}/members/${memberId}/merge-into/${targetMemberId}`, {
    method: "POST",
  });

// ---------- Currencies ----------
export const createCurrency = (tripId: number, data: { code: string; name?: string; rate_to_base: number }) =>
  request<Currency>(`/api/trips/${tripId}/currencies`, { method: "POST", body: JSON.stringify(data) });
export const updateCurrency = (currencyId: number, data: { name?: string; rate_to_base?: number }) =>
  request<Currency>(`/api/currencies/${currencyId}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCurrency = (currencyId: number) =>
  request<void>(`/api/currencies/${currencyId}`, { method: "DELETE" });
export interface CurrencyRatesBulkLookup {
  base_code: string;
  rates: Record<string, number>;
}
/** Trip-independent rate lookup: every rate the upstream API knows about,
 * against an arbitrary `base` code. Shared by CreateTripDialog (base = the
 * currency the user just picked in the still-unsaved form, so no trip_id
 * exists yet) and CurrenciesSection (base = trip.base_currency_code). */
export const getCurrencyRates = (base: string) =>
  request<CurrencyRatesBulkLookup>(`/api/currencies/rates?base=${encodeURIComponent(base)}`);

// ---------- Categories ----------
export const createCategory = (tripId: number, data: { name: string; color?: string }) =>
  request<Category>(`/api/trips/${tripId}/categories`, { method: "POST", body: JSON.stringify(data) });
export const updateCategory = (categoryId: number, data: { name?: string; color?: string }) =>
  request<Category>(`/api/categories/${categoryId}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCategory = (categoryId: number) =>
  request<void>(`/api/categories/${categoryId}`, { method: "DELETE" });
/** Wipes this trip's categories and recreates the default 7. Safe: Expense.category_id
 * is ondelete=SET NULL (see backend models.py), so affected expenses just become
 * uncategorized rather than failing. */
export const resetCategories = (tripId: number) =>
  request<Category[]>(`/api/trips/${tripId}/categories/reset`, { method: "POST" });

// ---------- Payment methods ----------
export const createPaymentMethod = (tripId: number, name: string) =>
  request<PaymentMethod>(`/api/trips/${tripId}/payment-methods`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
export const updatePaymentMethod = (pmId: number, name: string) =>
  request<PaymentMethod>(`/api/payment-methods/${pmId}`, { method: "PUT", body: JSON.stringify({ name }) });
export const deletePaymentMethod = (pmId: number) =>
  request<void>(`/api/payment-methods/${pmId}`, { method: "DELETE" });
/** Wipes this trip's payment methods and recreates the default 2 (現金/信用卡). Safe:
 * Expense.payment_method_id is ondelete=SET NULL (see backend models.py), so affected
 * expenses just become unset rather than failing. */
export const resetPaymentMethods = (tripId: number) =>
  request<PaymentMethod[]>(`/api/trips/${tripId}/payment-methods/reset`, { method: "POST" });

// ---------- Expenses ----------
export interface ExpenseFilters {
  date_from?: string;
  date_to?: string;
  category_id?: number;
  payer_id?: number;
  search?: string;
}
export const listExpenses = (tripId: number, filters?: ExpenseFilters) => {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    });
  }
  const qs = params.toString();
  return request<Expense[]>(`/api/trips/${tripId}/expenses${qs ? `?${qs}` : ""}`);
};
export const createExpense = (tripId: number, data: ExpenseInput) =>
  request<Expense>(`/api/trips/${tripId}/expenses`, { method: "POST", body: JSON.stringify(data) });
export const updateExpense = (tripId: number, expenseId: number, data: Partial<ExpenseInput>) =>
  request<Expense>(`/api/trips/${tripId}/expenses/${expenseId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
export const deleteExpense = (tripId: number, expenseId: number) =>
  request<void>(`/api/trips/${tripId}/expenses/${expenseId}`, { method: "DELETE" });
/** Equal-split preview by default; pass `shares` (member_id -> positive
 * integer share count) to get a weighted "依份數分攤" preview instead — see
 * backend/app/routers/expenses.py split_preview docstring. */
export const splitPreview = (
  tripId: number,
  amount: number,
  memberIds: number[],
  shares?: Record<number, number>
) =>
  request<Record<string, number>>(`/api/trips/${tripId}/expenses/split-preview`, {
    method: "POST",
    body: JSON.stringify(shares ? { amount, member_ids: memberIds, shares } : { amount, member_ids: memberIds }),
  });

// ---------- Settlement ----------
export const getSettlement = (tripId: number, currency?: string) =>
  request<Settlement>(`/api/trips/${tripId}/settlement${currency ? `?currency=${currency}` : ""}`);
/** "依原幣別分開結算" mode — one independent Settlement per currency the trip
 * actually has expenses in, no cross-currency conversion. See
 * SettlementPageClient.tsx's mode toggle. */
export const getSettlementByCurrency = (tripId: number) =>
  request<NativeSettlement>(`/api/trips/${tripId}/settlement/by-currency`);

// ---------- Uploads ----------
/** Uploads a receipt/reference image for an expense (jpg/jpeg/png/webp,
 * 5MB max — enforced server-side, see backend/app/routers/uploads.py) and
 * returns the relative URL to store as Expense.image_url / send as
 * ExpenseInput.image_url. Bypasses `request()` because this is a
 * multipart/form-data body, not JSON — the browser needs to set its own
 * Content-Type with the multipart boundary, which `request()`'s hardcoded
 * "Content-Type: application/json" header would otherwise clobber. */
export async function uploadExpenseImage(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/uploads/expense-image`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      // ignore parse failure, keep statusText
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as { url: string };
}
