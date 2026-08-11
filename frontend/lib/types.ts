// Mirrors backend/app/schemas.py — keep in sync with the FastAPI response models.

export interface Member {
  id: number;
  trip_id: number;
  name: string;
  color: string;
  order_index: number;
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
  created_at: string;
}

export interface TripDetail extends Trip {
  members: Member[];
  currencies: Currency[];
  categories: Category[];
  payment_methods: PaymentMethod[];
}

export interface TripSummary extends Trip {
  members: Member[];
  total_base_amount: number;
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

export interface Expense {
  id: number;
  trip_id: number;
  date: string;
  category_id: number | null;
  name: string;
  amount: number;
  currency_id: number;
  rate_snapshot: number;
  base_amount: number;
  payer_id: number;
  payment_method_id: number | null;
  note: string | null;
  needs_split: boolean;
  created_at: string;
  updated_at: string;
  shares: ExpenseShare[];
}

export interface ExpenseInput {
  date: string;
  category_id: number | null;
  name: string;
  amount: number;
  currency_id: number;
  payer_id: number;
  payment_method_id: number | null;
  note: string | null;
  needs_split: boolean;
  shares: ExpenseShareInput[];
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

export interface Settlement {
  currency_code: string;
  members: MemberSettlement[];
  matrix: DebtCell[];
  raw_relationship_count: number;
  suggested_transfers: TransferSuggestion[];
}
