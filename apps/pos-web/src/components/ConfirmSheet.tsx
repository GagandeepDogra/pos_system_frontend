import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';

interface Props {
  open: boolean;
  title: string;
  children?: ReactNode;
  /** Defaults to 'YES'. */
  yesLabel?: string;
  /** Defaults to 'NO'. */
  noLabel?: string;
  onYes: () => void;
  onNo: () => void;
}

/**
 * The one large confirm sheet for irreversible or money actions (REQ-090):
 * NO on the left, YES on the right. Slides in (150 ms) unless reduced motion is set.
 * Use it only when `needsConfirm(action)` says so.
 */
export function ConfirmSheet({ open, title, children, yesLabel, noLabel, onYes, onNo }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const noRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    noRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onNo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onNo]);

  if (!open) return null;
  return (
    <div className="sheet-scrim">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 className="sheet__title" id={titleId}>{title}</h2>
        {children}
        <div className="sheet__actions">
          <button ref={noRef} type="button" className="btn" onClick={onNo}>{noLabel ?? t('confirm.no')}</button>
          <button type="button" className="btn btn--primary" onClick={onYes}>{yesLabel ?? t('confirm.yes')}</button>
        </div>
      </div>
    </div>
  );
}
