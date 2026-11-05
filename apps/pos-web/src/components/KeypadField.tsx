import { useId, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'] as const;

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Allow a decimal point (amounts); off for PINs and quantities. */
  decimal?: boolean;
  maxLength?: number;
}

/**
 * Number field that opens the on-screen keypad instead of the system keyboard
 * (REQ-087): the input is read-only with inputMode="none".
 */
export function KeypadField({ label, value, onChange, decimal = true, maxLength = 9 }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();

  const press = (k: string) => {
    if (k === '.' && (!decimal || value.includes('.'))) return;
    if (value.length >= maxLength) return;
    const decimals = value.split('.')[1];
    if (decimals !== undefined && decimals.length >= 2) return;
    onChange(value === '0' && k !== '.' ? k : value + k);
  };

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <input
        id={id}
        className="field__input"
        readOnly
        inputMode="none"
        value={value}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
      />
      {open ? (
        <div className="keypad-sheet" role="dialog" aria-label={t('keypad.title')}>
          <div className="keypad-sheet__value" aria-live="polite">{value}</div>
          <div className="keypad">
            {KEYS.map((k) => (
              <button key={k} type="button" className="btn" disabled={k === '.' && !decimal} onClick={() => press(k)}>
                {k}
              </button>
            ))}
            <button type="button" className="btn" aria-label={t('keypad.backspace')} onClick={() => onChange(value.slice(0, -1))}>
              {'⌫'}
            </button>
          </div>
          <div className="keypad">
            <button type="button" className="btn" onClick={() => onChange('')}>{t('keypad.clear')}</button>
            <span />
            <button type="button" className="btn btn--primary" onClick={() => setOpen(false)}>{t('keypad.done')}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
