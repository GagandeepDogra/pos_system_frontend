import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  pending: boolean;
  /** Shown instead of the label while the request is being re-checked after a timeout. */
  checking?: boolean;
  variant?: 'primary' | 'secondary';
  children: ReactNode;
}

/**
 * Button for money and kitchen actions (Send, Pay): while the request is
 * pending it stays disabled with a spinner, so a second tap cannot resend.
 */
export function PendingButton({ pending, checking, variant = 'primary', children, disabled, className, ...rest }: Props) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      {...rest}
      className={`btn btn--${variant}${className ? ` ${className}` : ''}`}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
    >
      {pending ? <span className="spinner" role="progressbar" aria-label={t('status.working')} /> : null}
      <span>{pending && checking ? t('status.checking') : children}</span>
    </button>
  );
}
