import type { Language } from '@dhaba/shared';
import en from './locales/en.json';
import hi from './locales/hi.json';

type Tree = { [k: string]: string | Tree };
const DICTS: Record<Language, Tree> = { en, hi };

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Replaces {name} placeholders. */
function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export interface Translator {
  lang: Language;
  /** The string in the current language (English if a key is somehow missing). */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Always the English string (used for the bilingual pair and error bodies). */
  en: (key: string, vars?: Record<string, string | number>) => string;
  /**
   * Dashboard button label: in Hindi it renders the 'hi / en' pair
   * (e.g. 'रसोई / Kitchen') so English-reading staff are never lost.
   */
  pair: (key: string) => string;
}

export function createTranslator(lang: Language): Translator {
  const en = (key: string, vars?: Record<string, string | number>) => fill(lookup(DICTS.en, key) ?? key, vars);
  const t = (key: string, vars?: Record<string, string | number>) =>
    lang === 'en' ? en(key, vars) : fill(lookup(DICTS[lang], key) ?? en(key), vars);
  const pair = (key: string) => (lang === 'en' ? en(key) : `${t(key)} / ${en(key)}`);
  return { lang, t, en, pair };
}
