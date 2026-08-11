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
  TripDetail,
  TripSummary,
} from "./types";

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
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
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

// ---------- Members ----------
export const createMember = (tripId: number, name: string) =>
  request<Member>(`/api/trips/${tripId}/members`, { method: "POST", body: JSON.stringify({ name }) });
export const updateMember = (memberId: number, name: string) =>
  request<Member>(`/api/members/${memberId}`, { method: "PUT", body: JSON.stringify({ name }) });
export const deleteMember = (memberId: number) =>
  request<void>(`/api/members/${memberId}`, { method: "DELETE" });

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
