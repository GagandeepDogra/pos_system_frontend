import { useEffect } from 'react';
import { useI18n } from '../i18n/I18nProvider';

export const SUCCESS_BAR_MS = 2000;

export type ResultMessage =
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string; nextStep?: string };

/**
 * Full-width result bar (REQ-089): green with a tick, gone after 2 s;
 * red with the plain-language reason and what to do, until closed.
 */
export function ResultBar({ message, onDismiss }: { message: ResultMessage | null; onDismiss: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    if (message?.kind !== 'success') return;
    const timer = setTimeout(onDismiss, SUCCESS_BAR_MS);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;
  if (message.kind === 'success') {
    return (
      <div className="result-bar result-bar--success" role="status">
        <span aria-hidden="true">{'✓'}</span>
        <span className="result-bar__text">{message.text}</span>
      </div>
    );
  }
  return (
    <div className="result-bar result-bar--error" role="alert">
      <span aria-hidden="true">{'✕'}</span>
      <span className="result-bar__text">
        <span>{message.text}</span>
        {message.nextStep ? <span>{message.nextStep}</span> : null}
      </span>
      <button type="button" className="btn result-bar__close" onClick={onDismiss}>
        {t('actions.close')}
      </button>
    </div>
  );
}
