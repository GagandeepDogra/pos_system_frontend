import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';

export const PIN_LENGTH = 4;
const ZERO = '0';
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

interface Props {
  /** Visible heading, e.g. 'Ramesh' or 'Owner PIN'. */
  label: string;
  /** Called once 4 digits are entered; the pad clears itself. */
  onComplete: (pin: string) => void;
  /** Bump to shake the pad once (wrong PIN). */
  shakeKey?: number;
  /** Message under the dots (remaining tries, locked, rejected). */
  message?: string | null;
  disabled?: boolean;
}

/** Large on-screen PIN keypad (REQ-024, REQ-023): 4 dots, 3×4 keys of 56 px or more. */
export function PinPad({ label, onComplete, shakeKey = 0, message, disabled }: Props) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (!shakeKey) return;
    setShaking(true);
    const id = setTimeout(() => setShaking(false), 400);
    return () => clearTimeout(id);
  }, [shakeKey]);

  const press = (d: string) => {
    if (disabled) return;
    const next = (pin + d).slice(0, PIN_LENGTH);
    if (next.length === PIN_LENGTH) {
      setPin('');
      onComplete(next);
    } else setPin(next);
  };

  return (
    <div className={`pin-pad${shaking ? ' pin-pad--shake' : ''}`} data-testid="pin-pad" role="group" aria-label={label}>
      <p className="pin-pad__label">{label}</p>
      <div className="pin-pad__dots" aria-label={t('pin.entered', { count: pin.length })} role="img">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={`pin-pad__dot${i < pin.length ? ' pin-pad__dot--on' : ''}`} />
        ))}
      </div>
      {message ? <p className="pin-pad__message" role="alert">{message}</p> : null}
      <div className="pin-pad__keys">
        {DIGITS.map((d) => (
          <button key={d} type="button" className="btn pin-pad__key" disabled={disabled} onClick={() => press(d)}>{d}</button>
        ))}
        <button type="button" className="btn pin-pad__key" disabled={disabled} onClick={() => setPin('')}>{t('keypad.clear')}</button>
        <button type="button" className="btn pin-pad__key" disabled={disabled} onClick={() => press(ZERO)}>{ZERO}</button>
        <button type="button" className="btn pin-pad__key" disabled={disabled} aria-label={t('keypad.backspace')} onClick={() => setPin(pin.slice(0, -1))}>{'⌫'}</button>
      </div>
    </div>
  );
}
