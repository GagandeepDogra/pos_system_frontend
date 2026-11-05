import type {
  Category, DashboardTiles, DiningTable, TableView, Item, KitchenKotView, Kot, Language, MenuItemView, MenuView, Order, OrderException, OrderItem, Payment, PriceChange, Setting, User, Variant,
} from '@dhaba/shared';
import type { ApiClient, RequestOptions } from './client';

/** Options a screen may pass through (phase/conflict callbacks, timeouts). */
type Extra = Pick<RequestOptions, 'onPhase' | 'onConflict' | 'timeoutMs' | 'retries'>;

/**
 * One typed function per pos-api operation. Creating POSTs take the
 * idempotency key from the caller (make it once per tap, reuse it on retry);
 * updates take the row_version for If-Match.
 */
export function endpoints(api: ApiClient) {
  const r = api.request;
  return {
    getHealth: (x?: Extra) => r<{ status: 'green' | 'red'; [k: string]: unknown }>('/health', { ...x }),
    listLoginStaff: () => r<User[]>('/auth/staff'),
    login: (body: { user_id: string; pin: string; kitchen_device?: boolean }) =>
      r<{ token: string; user: User }>('/auth/login', { method: 'POST', body, retries: 0 }),
    createApproval: (key: string, body: { pin: string }) =>
      r<{ approval_token: string; admin_id: string }>('/auth/approvals', { method: 'POST', idempotencyKey: key, body }),
    updateMyLanguage: (rowVersion: number, language: Language, x?: Extra) =>
      r<User>('/me/language', { method: 'PATCH', ifMatch: rowVersion, body: { language }, ...x }),
    getDashboard: () => r<DashboardTiles>('/dashboard'),
    listTables: (query?: { area?: string; status?: string }) => r<TableView[]>('/tables', { query }),
    openTableSession: (key: string, body: Partial<Order>, x?: Extra) =>
      r<Order>('/orders/dine-in', { method: 'POST', idempotencyKey: key, body, ...x }),
    createTakeaway: (key: string, body: Partial<Order>, x?: Extra) =>
      r<Order>('/orders/takeaway', { method: 'POST', idempotencyKey: key, body, ...x }),
    getOrder: (id: string) => r<Order>(`/orders/${encodeURIComponent(id)}`),
    sendToKitchen: (orderId: string, key: string, body: { lines: Pick<OrderItem, 'variant_id' | 'quantity' | 'note'>[] }, x?: Extra) =>
      r<Kot>(`/orders/${encodeURIComponent(orderId)}/kots`, { method: 'POST', idempotencyKey: key, body, ...x }),
    getMenu: (q?: string) => r<MenuView | MenuItemView[]>('/menu', { query: { q } }),
    listKitchenKots: () => r<KitchenKotView[]>('/kitchen/kots'),
    updateKotStatus: (id: string, rowVersion: number, status: Kot['status'], x?: Extra) =>
      r<Kot>(`/kots/${encodeURIComponent(id)}/status`, { method: 'PATCH', ifMatch: rowVersion, body: { status }, ...x }),
    setItemAvailability: (id: string, rowVersion: number, available_today: boolean, x?: Extra) =>
      r<Item>(`/items/${encodeURIComponent(id)}/availability`, { method: 'PATCH', ifMatch: rowVersion, body: { available_today }, ...x }),
    markItemOutOfStock: (id: string) =>
      r<Item>(`/kitchen/items/${encodeURIComponent(id)}/out-of-stock`, { method: 'POST', retries: 0 }),
    cancelOrderItem: (id: string, rowVersion: number, cancel_reason: string, approvalToken?: string, x?: Extra) =>
      r<Order>(`/order-items/${encodeURIComponent(id)}/cancel`, { method: 'POST', ifMatch: rowVersion, approvalToken, body: { cancel_reason }, ...x }),
    moveOrder: (id: string, rowVersion: number, table_id: string, x?: Extra) =>
      r<Order>(`/orders/${encodeURIComponent(id)}/move`, { method: 'POST', ifMatch: rowVersion, body: { table_id }, ...x }),
    mergeOrders: (id: string, rowVersion: number, source_order_id: string, x?: Extra) =>
      r<Order>(`/orders/${encodeURIComponent(id)}/merge`, { method: 'POST', ifMatch: rowVersion, body: { source_order_id }, ...x }),
    printBill: (id: string, rowVersion: number, x?: Extra) =>
      r<Order>(`/orders/${encodeURIComponent(id)}/bill`, { method: 'POST', ifMatch: rowVersion, ...x }),
    applyDiscount: (id: string, rowVersion: number, body: Partial<OrderException>, approvalToken?: string, x?: Extra) =>
      r<Order>(`/orders/${encodeURIComponent(id)}/discount`, { method: 'POST', ifMatch: rowVersion, approvalToken, body, ...x }),
    listOpenBills: () => r<Order[]>('/bills/open'),
    recordPayment: (orderId: string, key: string, body: Pick<Payment, 'method' | 'amount'> & Partial<Payment>, x?: Extra) =>
      r<Payment>(`/orders/${encodeURIComponent(orderId)}/payments`, { method: 'POST', idempotencyKey: key, body, ...x }),
    voidPayment: (id: string, rowVersion: number, void_reason: string, approvalToken?: string, x?: Extra) =>
      r<Payment>(`/payments/${encodeURIComponent(id)}/void`, { method: 'POST', ifMatch: rowVersion, approvalToken, body: { void_reason }, ...x }),
    closeWithException: (id: string, rowVersion: number, body: Partial<OrderException>, approvalToken?: string, x?: Extra) =>
      r<Order>(`/orders/${encodeURIComponent(id)}/close-exception`, { method: 'POST', ifMatch: rowVersion, approvalToken, body, ...x }),
    recordReceiptPrint: (orderId: string, key: string) =>
      r<Order>(`/orders/${encodeURIComponent(orderId)}/receipt-prints`, { method: 'POST', idempotencyKey: key }),
    listActiveTakeaways: () => r<Order[]>('/takeaways'),
    handOverTakeaway: (id: string, rowVersion: number, x?: Extra) =>
      r<Order>(`/takeaways/${encodeURIComponent(id)}/handover`, { method: 'POST', ifMatch: rowVersion, ...x }),
    createCategory: (key: string, body: Partial<Category>) =>
      r<Category>('/admin/categories', { method: 'POST', idempotencyKey: key, body }),
    updateCategory: (id: string, rowVersion: number, body: Partial<Category>, x?: Extra) =>
      r<Category>(`/admin/categories/${encodeURIComponent(id)}`, { method: 'PATCH', ifMatch: rowVersion, body, ...x }),
    createItem: (key: string, body: Partial<Item>) => r<Item>('/admin/items', { method: 'POST', idempotencyKey: key, body }),
    updateItem: (id: string, rowVersion: number, body: Partial<Item>, x?: Extra) =>
      r<Item>(`/admin/items/${encodeURIComponent(id)}`, { method: 'PATCH', ifMatch: rowVersion, body, ...x }),
    createVariant: (itemId: string, key: string, body: Partial<Variant>) =>
      r<Variant>(`/admin/items/${encodeURIComponent(itemId)}/variants`, { method: 'POST', idempotencyKey: key, body }),
    updateVariant: (id: string, rowVersion: number, body: Partial<Variant>, x?: Extra) =>
      r<Variant>(`/admin/variants/${encodeURIComponent(id)}`, { method: 'PATCH', ifMatch: rowVersion, body, ...x }),
    changeVariantPrice: (id: string, key: string, rowVersion: number, body: Pick<PriceChange, 'new_price' | 'reason'>, x?: Extra) =>
      r<PriceChange>(`/admin/variants/${encodeURIComponent(id)}/price-changes`, { method: 'POST', idempotencyKey: key, ifMatch: rowVersion, body, ...x }),
    createTable: (key: string, body: Partial<DiningTable>) =>
      r<DiningTable>('/admin/tables', { method: 'POST', idempotencyKey: key, body }),
    updateTable: (id: string, rowVersion: number, body: Partial<DiningTable>, x?: Extra) =>
      r<DiningTable>(`/admin/tables/${encodeURIComponent(id)}`, { method: 'PATCH', ifMatch: rowVersion, body, ...x }),
    createUser: (key: string, body: Partial<User> & { pin: string }) =>
      r<User>('/admin/users', { method: 'POST', idempotencyKey: key, body }),
    updateUser: (id: string, rowVersion: number, body: Partial<User>, x?: Extra) =>
      r<User>(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', ifMatch: rowVersion, body, ...x }),
    resetUserPin: (id: string, rowVersion: number, pin: string, x?: Extra) =>
      r<User>(`/admin/users/${encodeURIComponent(id)}/pin-reset`, { method: 'POST', ifMatch: rowVersion, body: { pin }, ...x }),
    getSalesReport: (from: string, to: string) => r<Record<string, unknown>>('/admin/reports/sales', { query: { from, to } }),
    searchOrders: (query: { date?: string; bill_no?: string; table?: string; token?: string }) =>
      r<Order[]>('/admin/orders', { query }),
    downloadBackup: (snapshot?: string) =>
      r<Blob>('/admin/backups/download', { query: { snapshot }, responseType: 'blob', timeoutMs: 60000, retries: 0 }),
    previewRestore: (key: string, body: unknown) =>
      r<Record<string, unknown>>('/admin/restores', { method: 'POST', idempotencyKey: key, body, timeoutMs: 120000 }),
    confirmRestore: (id: string, body: { pin: string; pin_confirm: string }) =>
      r<Record<string, unknown>>(`/admin/restores/${encodeURIComponent(id)}/confirm`, { method: 'POST', body, retries: 0, timeoutMs: 120000 }),
    getSettings: () => r<Setting>('/settings'),
    updateSettings: (rowVersion: number, body: Partial<Setting>, x?: Extra) =>
      r<Setting>('/admin/settings', { method: 'PUT', ifMatch: rowVersion, body, ...x }),
    getDayCloseSummary: () => r<Record<string, unknown>>('/admin/day-close'),
    closeDay: (key: string) => r<Record<string, unknown>>('/admin/day-close', { method: 'POST', idempotencyKey: key, timeoutMs: 60000 }),
  };
}
