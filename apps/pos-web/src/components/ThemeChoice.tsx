import type { Role } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { darkThemeAllowed } from '../design/rules';

const STORAGE_KEY = 'dhaba.kitchenDarkTheme';

export function getKitchenDarkTheme(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setKitchenDarkTheme(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
}

/** Class to put on the kitchen screen root; empty unless the device is a kitchen device with dark on. */
export function kitchenThemeClass(deviceRole: Role | null, dark: boolean): string {
  return darkThemeAllowed(deviceRole) && dark ? 'theme-kitchen-dark' : '';
}

/** Settings row 'Dark screen'. Renders nothing on cashier or admin devices (REQ-092). */
export function ThemeChoice({ deviceRole, dark, onChange }: { deviceRole: Role | null; dark: boolean; onChange: (dark: boolean) => void }) {
  const { t } = useI18n();
  if (!darkThemeAllowed(deviceRole)) return null;
  return (
    <div className="theme-choice" role="group" aria-label={t('theme.label')}>
      <span className="field__label">{t('theme.label')}</span>
      <div className="choice-row">
        <button type="button" className="btn" aria-pressed={!dark} onClick={() => onChange(false)}>{t('theme.light')}</button>
        <button type="button" className="btn" aria-pressed={dark} onClick={() => onChange(true)}>{t('theme.dark')}</button>
      </div>
    </div>
  );
}
