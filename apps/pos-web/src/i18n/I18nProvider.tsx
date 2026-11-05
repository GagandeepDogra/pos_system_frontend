import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { Language } from '@dhaba/shared';
import { createTranslator, type Translator } from './translate';

const I18nContext = createContext<Translator>(createTranslator('en'));

export function I18nProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  const value = useMemo(() => createTranslator(lang), [lang]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Translator {
  return useContext(I18nContext);
}
