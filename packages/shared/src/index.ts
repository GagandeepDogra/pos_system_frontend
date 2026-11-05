/**
 * Shared types and enums for pos-web and pos-api.
 * Every enum used by both apps lives here (checked by tools/check-shared-enums.mjs).
 */

export const ROLES = ['ADMIN', 'CASHIER', 'KITCHEN'] as const;
export type Role = (typeof ROLES)[number];

export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Derived table status (never stored): no OPEN/BILLED order, OPEN, BILLED. */
export const TABLE_STATUSES = ['AVAILABLE', 'OCCUPIED', 'READY_TO_CLOSE'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const ORDER_TYPES = ['DINE_IN', 'TAKEAWAY'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = ['OPEN', 'BILLED', 'PAID', 'CLOSED_EXCEPTION', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const KOT_STATUSES = ['NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'] as const;
export type KotStatus = (typeof KOT_STATUSES)[number];

export const ORDER_ITEM_STATUSES = ['ACTIVE', 'CANCELLED'] as const;
export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['SUCCESS', 'VOIDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FOOD_TYPES = ['VEG', 'NON_VEG'] as const;
export type FoodType = (typeof FOOD_TYPES)[number];

export const EXCEPTION_TYPES = [
  'DISCOUNT',
  'BILL_REOPEN',
  'CANCEL_AFTER_START',
  'CLOSE_WITH_BALANCE',
  'PAYMENT_VOID',
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export const CLOSE_REASON_CODES = ['COMPLIMENTARY', 'CUSTOMER_LEFT', 'STAFF_MEAL', 'OTHER'] as const;
export type CloseReasonCode = (typeof CLOSE_REASON_CODES)[number];

export const PRICE_CHANGE_REASONS = ['MARKET_RATE', 'NEW_SEASON', 'CORRECTION', 'OTHER'] as const;
export type PriceChangeReason = (typeof PRICE_CHANGE_REASONS)[number];

/** Error codes carried in the API error body. */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'TABLE_BUSY',
  'ITEM_UNAVAILABLE',
  'OVERPAYMENT',
  'LOCKED',
  'TOO_MANY_REQUESTS',
  'PRECONDITION_REQUIRED',
  'UNPROCESSABLE',
  'SERVER_ERROR',
  'UNAVAILABLE',
  'NETWORK',
  'TIMEOUT',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Shape of every API error body: {code, message_en, message_hi, details}. */
export interface ApiErrorBody {
  code: ErrorCode | string;
  message_en: string;
  message_hi: string;
  details?: unknown;
}

/** Decimal values travel as strings with 2 dp. */
export type Decimal = string;

interface Audited {
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  row_version: number;
}

export interface User extends Audited {
  id: string;
  display_name: string;
  role: Role;
  language: Language;
  is_active: boolean;
  failed_pin_count: number;
  locked_until?: string | null;
  token_version: number;
}

export interface Setting extends Audited {
  id: string;
  dhaba_name: string;
  address: string;
  phone: string;
  gst_number?: string | null;
  gst_rate_percent?: Decimal | null;
  receipt_footer: string;
  token_reset_time: string;
  shift_end_time?: string | null;
  late_kot_minutes: number;
  discount_limit_amount: Decimal;
  kitchen_print_enabled: boolean;
}

export interface DiningTable extends Audited {
  id: string;
  table_number: string;
  area?: string | null;
  seats?: number | null;
  is_active: boolean;
}

export interface Category extends Audited {
  id: string;
  name_en: string;
  name_hi: string;
  sort_order: number;
  is_active: boolean;
}

export interface Item extends Audited {
  id: string;
  category_id: string;
  name_en: string;
  name_hi: string;
  short_code: string;
  food_type: FoodType;
  photo_url?: string | null;
  kitchen_station?: string | null;
  is_active: boolean;
  available_today: boolean;
}

export interface Variant extends Audited {
  id: string;
  item_id: string;
  name: string;
  price: Decimal;
  sort_order: number;
  is_active: boolean;
}

export interface Order extends Audited {
  id: string;
  order_type: OrderType;
  business_date: string;
  table_id?: string | null;
  table_label_snapshot?: string | null;
  token?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  guest_count?: number | null;
  status: OrderStatus;
  bill_no?: string | null;
  subtotal: Decimal;
  discount_amount: Decimal;
  discount_reason?: string | null;
  tax_amount: Decimal;
  round_off: Decimal;
  grand_total: Decimal;
  paid_amount: Decimal;
  balance_due: Decimal;
  merged_into_order_id?: string | null;
  handed_over_at?: string | null;
  client_request_id: string;
}

export interface Kot extends Audited {
  id: string;
  kot_number: number;
  business_date: string;
  order_id: string;
  status: KotStatus;
  idempotency_key: string;
  sent_at: string;
  served_at?: string | null;
  hide_after?: string | null;
}

export interface OrderItem extends Audited {
  id: string;
  order_id: string;
  kot_id: string;
  variant_id: string;
  item_name_snapshot: string;
  item_name_hi_snapshot: string;
  variant_name_snapshot: string;
  food_type_snapshot: FoodType;
  unit_price: Decimal;
  quantity: number;
  line_total: Decimal;
  note?: string | null;
  status: OrderItemStatus;
  cancel_reason?: string | null;
}

export interface Payment extends Audited {
  id: string;
  order_id: string;
  business_date: string;
  method: PaymentMethod;
  amount: Decimal;
  tendered_amount?: Decimal | null;
  upi_ref?: string | null;
  status: PaymentStatus;
  void_reason?: string | null;
  voided_by?: string | null;
  idempotency_key: string;
}

export interface OrderException {
  id: string;
  order_id: string;
  exception_type: ExceptionType;
  reason_code: string;
  reason_text?: string | null;
  amount?: Decimal | null;
  requested_by: string;
  approved_by?: string | null;
  created_at: string;
}

export interface PriceChange {
  id: string;
  variant_id: string;
  old_price: Decimal;
  new_price: Decimal;
  reason: PriceChangeReason;
  changed_by: string;
  created_at: string;
}

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
}

export const HTTP_METHODS = ['GET', 'POST', 'PATCH', 'PUT'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
