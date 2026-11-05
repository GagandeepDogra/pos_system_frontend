// Pure check functions used by the CI scripts in this folder (tested in checks.test.mjs).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const LOCALES_DIR = 'apps/pos-web/src/i18n/locales';

/** Flattens {a:{b:'x'}} into ['a.b']. */
export function flattenKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flattenKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

/** Keys present in one locale but not the other, and empty values. */
export function diffLocaleKeys(en, hi) {
  const enKeys = new Set(flattenKeys(en));
  const hiKeys = new Set(flattenKeys(hi));
  const empty = (tree, lang) =>
    flattenKeys(tree).filter((k) => !String(k.split('.').reduce((n, p) => n[p], tree)).trim()).map((k) => `${lang}:${k}`);
  return {
    missingInHi: [...enKeys].filter((k) => !hiKeys.has(k)),
    missingInEn: [...hiKeys].filter((k) => !enKeys.has(k)),
    empty: [...empty(en, 'en'), ...empty(hi, 'hi')],
  };
}

/** Technical words staff must never see (plain words on staff screens). */
export const BANNED_WORDS = [/\binvoice\b/i, /\bsubmit\s+kot\b/i, /\bvoid\s+line\b/i];

export function findBannedWords(text) {
  return BANNED_WORDS.filter((re) => re.test(text)).map((re) => re.source);
}

/**
 * Enum-like definitions outside packages/shared: TS enums, or unions / const
 * arrays of 2+ UPPER_CASE string literals (e.g. 'OPEN' | 'PAID').
 */
const ENUM_PATTERNS = [
  /\benum\s+\w+\s*\{/,
  /'[A-Z][A-Z0-9_]+'\s*\|\s*'[A-Z][A-Z0-9_]+'/,
  /"[A-Z][A-Z0-9_]+"\s*\|\s*"[A-Z][A-Z0-9_]+"/,
  /\[\s*'[A-Z][A-Z0-9_]+'\s*,\s*'[A-Z][A-Z0-9_]+'[^\]]*\]\s*as\s+const/,
];

export function findEnumDefinitions(text) {
  return text
    .split('\n')
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter(({ text: l }) => !l.trim().startsWith('//') && ENUM_PATTERNS.some((re) => re.test(l)));
}

export function listFiles(dir, exts) {
  let out = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === 'coverage') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out = out.concat(listFiles(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

/** Files below the threshold among those under a storage/ or billing/ folder. */
export function coverageFailures(summary, root, threshold = 80) {
  const failures = [];
  for (const [file, metrics] of Object.entries(summary)) {
    if (file === 'total') continue;
    const rel = relative(root, file).split(sep).join('/');
    if (!/(^|\/)(storage|billing)\//.test(rel)) continue;
    for (const m of ['lines', 'statements', 'functions', 'branches']) {
      if (metrics[m] && metrics[m].total > 0 && metrics[m].pct < threshold) failures.push(`${rel} ${m} ${metrics[m].pct}%`);
    }
  }
  return failures;
}

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
