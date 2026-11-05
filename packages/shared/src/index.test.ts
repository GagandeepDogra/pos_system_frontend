import { describe, expect, it } from 'vitest';
import { isLanguage, LANGUAGES, ROLES } from './index';

describe('shared enums (REQ-136)', () => {
  it('exposes roles and languages', () => {
    expect(ROLES).toEqual(['ADMIN', 'CASHIER', 'KITCHEN']);
    expect(LANGUAGES).toEqual(['en', 'hi']);
  });
  it('isLanguage accepts en/hi only', () => {
    expect(isLanguage('hi')).toBe(true);
    expect(isLanguage('pa')).toBe(false);
  });
});
