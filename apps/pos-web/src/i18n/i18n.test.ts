import { describe, expect, it, vi } from 'vitest';
import type { User } from '@dhaba/shared';
import { createTranslator } from './translate';
import { getUserLanguage, setUserLanguage } from './languageStore';
import { switchUserLanguage } from './switchLanguage';

const user = (id: string, row_version = 1): User => ({
  id, display_name: id, role: 'CASHIER', language: 'en', is_active: true, failed_pin_count: 0, token_version: 1,
  created_at: '', created_by: '', updated_at: '', updated_by: '', row_version,
});

describe('i18n (REQ-008)', () => {
  it('REQ-008: in Hindi the dashboard kitchen button shows the hi / en pair', () => {
    expect(createTranslator('en').pair('dashboard.kitchen')).toBe('Kitchen');
    expect(createTranslator('hi').pair('dashboard.kitchen')).toBe('रसोई / Kitchen');
  });

  it('REQ-008: changing one user language does not change another user', () => {
    setUserLanguage('use_a', 'hi');
    expect(getUserLanguage('use_a')).toBe('hi');
    expect(getUserLanguage('use_b')).toBe('en');
    setUserLanguage('use_b', 'en');
    expect(getUserLanguage('use_a')).toBe('hi');
  });

  it('REQ-008: switchUserLanguage saves on the server and refreshes once on 409', async () => {
    const updateMyLanguage = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 409, error: {}, current: { ...user('use_a', 7) } })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { ...user('use_a', 8), language: 'hi' } });
    const res = await switchUserLanguage({ updateMyLanguage }, user('use_a', 6), 'hi');
    expect(res.ok).toBe(true);
    expect(updateMyLanguage.mock.calls).toEqual([[6, 'hi'], [7, 'hi']]);
    expect(getUserLanguage('use_a')).toBe('hi');
    expect(getUserLanguage('use_b')).toBe('en');
  });
});
