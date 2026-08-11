import type {
  Category,
  Currency,
  Expense,
  ExpenseInput,
  Member,
  PaymentMethod,
  Settlement,
  Trip,
  TripDetail,
  TripSummary,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

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

// ---------- Categories ----------
export const createCategory = (tripId: number, data: { name: string; color?: string }) =>
  request<Category>(`/api/trips/${tripId}/categories`, { method: "POST", body: JSON.stringify(data) });
export const updateCategory = (categoryId: number, data: { name?: string; color?: string }) =>
  request<Category>(`/api/categories/${categoryId}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCategory = (categoryId: number) =>
  request<void>(`/api/categories/${categoryId}`, { method: "DELETE" });

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
export const splitPreview = (tripId: number, amount: number, memberIds: number[]) =>
  request<Record<string, number>>(`/api/trips/${tripId}/expenses/split-preview`, {
    method: "POST",
    body: JSON.stringify({ amount, member_ids: memberIds }),
  });

// ---------- Settlement ----------
export const getSettlement = (tripId: number, currency?: string) =>
  request<Settlement>(`/api/trips/${tripId}/settlement${currency ? `?currency=${currency}` : ""}`);
