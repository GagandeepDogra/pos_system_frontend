import { useState } from 'react';
import type { Language } from '@dhaba/shared';
import { I18nProvider } from './i18n/I18nProvider';
import { getUserLanguage, setUserLanguage } from './i18n/languageStore';
import { LoginScreen } from './screens/LoginScreen';
import { DesignPreview } from './screens/DesignPreview';

/** Before anyone logs in, the login screen uses the device's last choice. */
const DEVICE_USER = '__device__';

export function App() {
  const [lang, setLang] = useState<Language>(() => getUserLanguage(DEVICE_USER));
  const choose = (l: Language) => {
    setUserLanguage(DEVICE_USER, l);
    setLang(l);
  };
  return (
    <I18nProvider lang={lang}>
      {import.meta.env.DEV && window.location.hash === '#/design' ? <DesignPreview /> : <LoginScreen onLanguage={choose} />}
    </I18nProvider>
  );
}
