import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { coverageFailures, diffLocaleKeys, findBannedWords, findEnumDefinitions } from './checks.mjs';

describe('CI checks (REQ-137, REQ-087, REQ-136)', () => {
  it('REQ-137: a key present in en but missing from hi fails', () => {
    const res = diffLocaleKeys({ a: { b: 'x', c: 'y' } }, { a: { b: 'क' } });
    expect(res.missingInHi).toEqual(['a.c']);
    expect(diffLocaleKeys({ a: 'x' }, { a: 'क' }).missingInHi).toEqual([]);
  });

  it("REQ-087: a scan finding 'Invoice' or 'Submit KOT' fails", () => {
    expect(findBannedWords('{"x":"Print Invoice"}').length).toBe(1);
    expect(findBannedWords('{"x":"Submit  KOT"}').length).toBe(1);
    expect(findBannedWords('{"x":"Send to Kitchen","y":"Bill"}')).toEqual([]);
  });

  it('REQ-136: an enum defined outside packages/shared fails', () => {
    expect(findEnumDefinitions("type S = 'OPEN' | 'PAID';").length).toBe(1);
    expect(findEnumDefinitions('enum Role { ADMIN }').length).toBe(1);
    expect(findEnumDefinitions("const R = ['ADMIN', 'CASHIER'] as const;").length).toBe(1);
    expect(findEnumDefinitions("import type { Role } from '@dhaba/shared';")).toEqual([]);
  });

  it('REQ-136: coverage below 80% in storage or billing fails', () => {
    const m = (pct) => ({ lines: { total: 10, pct }, statements: { total: 10, pct }, functions: { total: 1, pct }, branches: { total: 1, pct } });
    const summary = {
      total: m(50),
      '/r/apps/pos-api/src/billing/totals.ts': m(79),
      '/r/apps/pos-api/src/storage/queue.ts': m(95),
      '/r/apps/pos-web/src/App.tsx': m(10),
    };
    const failures = coverageFailures(summary, '/r');
    expect(failures.length).toBe(4);
    expect(failures.every((f) => f.includes('billing/totals.ts'))).toBe(true);
  });

  it('REQ-137: the lint rule fails on a literal staff-facing string in a component', async () => {
    const eslint = new ESLint();
    const bad = await eslint.lintText('export const A = () => <button>Submit</button>;\n', {
      filePath: 'apps/pos-web/src/components/Bad.tsx',
    });
    expect(bad[0].messages.some((msg) => msg.ruleId === 'react/jsx-no-literals')).toBe(true);
    const good = await eslint.lintText("export const A = ({ t }: { t: (k: string) => string }) => <button>{t('actions.pay')}</button>;\n", {
      filePath: 'apps/pos-web/src/components/Good.tsx',
    });
    expect(good[0].messages.filter((msg) => msg.ruleId === 'react/jsx-no-literals')).toEqual([]);
  }, 30000);
});
