import { LANGUAGES, type Language } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';

/**
 * First screen of the app shell. Staff tiles, PIN entry and user switch are
 * added by the login work; this shell shows the title and the language choice.
 */
export function LoginScreen({ onLanguage }: { onLanguage: (lang: Language) => void }) {
  const { t, lang } = useI18n();
  return (
    <div className="shell">
      <header className="top-bar">
        <div className="top-bar__row">
          <span>{t('app.name')}</span>
        </div>
      </header>
      <main className="workspace">
        <h1 className="heading">{t('login.title')}</h1>
        <p className="muted">{t('login.subtitle')}</p>
        <div className="lang-switch" role="group" aria-label={t('language.label')}>
          {LANGUAGES.map((l) => (
            <button key={l} type="button" className="btn" aria-pressed={lang === l} onClick={() => onLanguage(l)}>
              {t(`language.${l}`)}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
