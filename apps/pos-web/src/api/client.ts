import type { ApiErrorBody, ErrorCode, HttpMethod } from '@dhaba/shared';
import { createTranslator } from '../i18n/translate';

/**
 * Typed client for pos-api (/api/v1).
 *
 * - Creating POSTs carry an Idempotency-Key. The caller creates ONE key per tap
 *   (newIdempotencyKey) and every retry reuses it, so a slow first try that did
 *   reach the server cannot create a duplicate.
 * - Updates carry If-Match: <row_version>. A 409 returns the current row in
 *   `current`; onConflict lets the screen refresh before the user tries again.
 * - Timeouts and network failures are retried with the same key; while that
 *   happens the status goes to 'checking' ("Checking...").
 * - Every failure is normalised to {code, message_en, message_hi, details} with
 *   non-empty plain-language messages.
 */

export type RequestPhase = 'pending' | 'checking' | 'saved' | 'failed';

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: number;
  approvalToken?: string;
  /** Per-attempt timeout in ms (default 8000). */
  timeoutMs?: number;
  /** Extra attempts after a timeout / network error / 5xx (default 2 for safe requests). */
  retries?: number;
  onPhase?: (phase: RequestPhase) => void;
  onConflict?: (current: unknown) => void;
  /** 'blob' returns the body as a Blob on success (backup download). */
  responseType?: 'json' | 'blob';
}

/** A FormData/Blob body is sent as is (the browser sets the multipart Content-Type). */
function isRawBody(body: unknown): body is FormData | Blob {
  return (typeof FormData !== 'undefined' && body instanceof FormData) || (typeof Blob !== 'undefined' && body instanceof Blob);
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiErrorBody; current?: unknown };

export interface ApiClientConfig {
  baseUrl?: string;
  getToken?: () => string | null | undefined;
  fetchImpl?: typeof fetch;
  /** Wait between retries in ms (default 500, multiplied by attempt). */
  retryDelayMs?: number;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  423: 'LOCKED',
  428: 'PRECONDITION_REQUIRED',
  429: 'TOO_MANY_REQUESTS',
  503: 'UNAVAILABLE',
};

const enT = createTranslator('en');
const hiT = createTranslator('hi');

function messagesFor(code: string): { message_en: string; message_hi: string } {
  const key = `errors.${code}`;
  const known = enT.en(key) !== key;
  const k = known ? key : 'errors.UNPROCESSABLE';
  return { message_en: enT.t(k), message_hi: hiT.t(k) };
}

/** Builds a complete error body, filling any missing message from the translation files. */
export function normaliseError(status: number, raw: unknown): ApiErrorBody {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Partial<ApiErrorBody>;
  const code =
    typeof body.code === 'string' && body.code
      ? body.code
      : (STATUS_CODES[status] ?? (status >= 500 ? 'SERVER_ERROR' : 'UNPROCESSABLE'));
  const fallback = messagesFor(code);
  return {
    code,
    message_en: typeof body.message_en === 'string' && body.message_en.trim() ? body.message_en : fallback.message_en,
    message_hi: typeof body.message_hi === 'string' && body.message_hi.trim() ? body.message_hi : fallback.message_hi,
    details: body.details,
  };
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

class TimeoutError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createApiClient(config: ApiClientConfig = {}) {
  const baseUrl = config.baseUrl ?? '/api/v1';
  const retryDelayMs = config.retryDelayMs ?? 500;

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
    const fetchImpl = config.fetchImpl ?? fetch;
    const method = opts.method ?? 'GET';
    // A write is only safe to retry when the server can de-duplicate it.
    const retryable = method === 'GET' || !!opts.idempotencyKey || opts.ifMatch !== undefined;
    const maxRetries = retryable ? (opts.retries ?? 2) : 0;
    const timeoutMs = opts.timeoutMs ?? 8000;

    const url = new URL(baseUrl + path, 'http://placeholder');
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const target = baseUrl.startsWith('http') ? url.toString() : url.pathname + url.search;

    const headers: Record<string, string> = { Accept: 'application/json' };
    const raw = isRawBody(opts.body);
    if (opts.body !== undefined && !raw) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (opts.ifMatch !== undefined) headers['If-Match'] = String(opts.ifMatch);
    if (opts.approvalToken) headers['X-Approval-Token'] = opts.approvalToken;
    const token = config.getToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;

    opts.onPhase?.('pending');
    let lastError: ApiErrorBody = normaliseError(0, { code: 'NETWORK' });
    let lastStatus = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        opts.onPhase?.('checking');
        await sleep(retryDelayMs * attempt);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new TimeoutError()), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(target, {
          method,
          headers,
          body: opts.body === undefined ? undefined : raw ? (opts.body as FormData | Blob) : JSON.stringify(opts.body),
          signal: controller.signal,
        });
      } catch (e) {
        const timedOut = e instanceof TimeoutError || controller.signal.reason instanceof TimeoutError;
        lastError = normaliseError(0, { code: timedOut ? 'TIMEOUT' : 'NETWORK' });
        lastStatus = 0;
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok && opts.responseType === 'blob') {
        opts.onPhase?.('saved');
        return { ok: true, status: res.status, data: (await res.blob()) as T };
      }
      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }

      if (res.ok) {
        opts.onPhase?.('saved');
        return { ok: true, status: res.status, data: json as T };
      }
      if (res.status >= 500 && attempt < maxRetries) {
        lastError = normaliseError(res.status, json);
        lastStatus = res.status;
        continue;
      }
      opts.onPhase?.('failed');
      if (res.status === 409) {
        // The contract returns the current row (or the existing order for TABLE_BUSY).
        const current = json && typeof json === 'object' && 'row_version' in json ? json : undefined;
        if (current !== undefined) opts.onConflict?.(current);
        return {
          ok: false,
          status: 409,
          error: normaliseError(409, current ? {} : json),
          current,
        };
      }
      return { ok: false, status: res.status, error: normaliseError(res.status, json) };
    }

    opts.onPhase?.('failed');
    return { ok: false, status: lastStatus, error: lastError };
  }

  return { request };
}

export type ApiClient = ReturnType<typeof createApiClient>;
