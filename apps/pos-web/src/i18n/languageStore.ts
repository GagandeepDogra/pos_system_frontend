import { isLanguage, type Language } from '@dhaba/shared';

/**
 * Language is chosen per user, not per device. The server is the source of
 * truth (User.language, PATCH /me/language); this local cache only lets a
 * shared device render the right language before the server answers.
 */
const STORAGE_KEY = 'dhaba.userLanguages';

function readAll(storage: Storage): Record<string, Language> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => isLanguage(v))) as Record<string, Language>;
  } catch {
    return {};
  }
}

export function getUserLanguage(userId: string, fallback: Language = 'en', storage: Storage = localStorage): Language {
  return readAll(storage)[userId] ?? fallback;
}

export function setUserLanguage(userId: string, lang: Language, storage: Storage = localStorage): void {
  const all = readAll(storage);
  all[userId] = lang;
  storage.setItem(STORAGE_KEY, JSON.stringify(all));
}
