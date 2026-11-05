import { describe, expect, it, vi } from 'vitest';
import { createApiClient, normaliseError, newIdempotencyKey } from './client';
import { endpoints } from './endpoints';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function headersOf(call: unknown[]): Record<string, string> {
  return (call[1] as RequestInit).headers as Record<string, string>;
}

describe('api client (REQ-118, REQ-112, REQ-113)', () => {
  it('REQ-118: a retried request reuses the original idempotency key', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(json(500, {}))
      .mockResolvedValueOnce(json(201, { id: 'pay_1' }));
    const api = endpoints(createApiClient({ fetchImpl, retryDelayMs: 0 }));
    const key = newIdempotencyKey();
    const phases: string[] = [];
    const res = await api.recordPayment('ord_1', key, { method: 'CASH', amount: '100.00' }, { onPhase: (p) => phases.push(p) });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const call of fetchImpl.mock.calls) expect(headersOf(call)['Idempotency-Key']).toBe(key);
    expect(phases).toEqual(['pending', 'checking', 'checking', 'saved']);
  });

  it('REQ-118: a timed-out attempt shows Checking... then Not saved when every retry fails', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(init.signal?.reason))),
    );
    const api = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 0 });
    const phases: string[] = [];
    const res = await api.request('/orders/o/kots', {
      method: 'POST', idempotencyKey: 'k1', body: {}, timeoutMs: 5, retries: 1, onPhase: (p) => phases.push(p),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('TIMEOUT');
      expect(res.error.message_en).toBe('Not saved, try again');
    }
    expect(phases).toEqual(['pending', 'checking', 'failed']);
  });

  it('does not retry a write that has no idempotency key or If-Match', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('down'));
    const api = createApiClient({ fetchImpl, retryDelayMs: 0 });
    await api.request('/kitchen/items/i/out-of-stock', { method: 'POST' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('REQ-113: sends If-Match and returns the current row on 409 for a refresh', async () => {
    const current = { id: 'kot_1', status: 'PREPARING', row_version: 5 };
    const fetchImpl = vi.fn().mockResolvedValue(json(409, current));
    const onConflict = vi.fn();
    const api = endpoints(createApiClient({ fetchImpl, getToken: () => 'jwt' }));
    const res = await api.updateKotStatus('kot_1', 4, 'READY', { onConflict });
    expect(headersOf(fetchImpl.mock.calls[0])['If-Match']).toBe('4');
    expect(headersOf(fetchImpl.mock.calls[0]).Authorization).toBe('Bearer jwt');
    expect(onConflict).toHaveBeenCalledWith(current);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.current).toEqual(current);
      expect(res.error.code).toBe('CONFLICT');
    }
  });

  it('REQ-114: a 422 OVERPAYMENT carries non-empty message_en and message_hi', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(422, { code: 'OVERPAYMENT', message_en: '', details: null }));
    const api = endpoints(createApiClient({ fetchImpl }));
    const res = await api.recordPayment('ord_1', 'k', { method: 'CASH', amount: '999.00' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(422);
      expect(res.error.code).toBe('OVERPAYMENT');
      expect(res.error.message_en.length).toBeGreaterThan(0);
      expect(res.error.message_hi.length).toBeGreaterThan(0);
    }
  });

  it('keeps server messages when present and maps unknown codes', () => {
    expect(normaliseError(422, { code: 'X', message_en: 'a', message_hi: 'b' })).toMatchObject({ message_en: 'a', message_hi: 'b' });
    expect(normaliseError(404, null).code).toBe('NOT_FOUND');
    expect(normaliseError(502, null).code).toBe('SERVER_ERROR');
  });

  it('builds query strings and paths', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, []));
    const api = endpoints(createApiClient({ fetchImpl }));
    await api.listTables({ area: 'Garden', status: undefined });
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/v1/tables?area=Garden');
  });
});
