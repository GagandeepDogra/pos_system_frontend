import { useI18n } from '../i18n/I18nProvider';

export type OrderContext =
  | { kind: 'table'; table: string; detail?: string; readyToClose?: boolean }
  | { kind: 'token'; token: string; detail?: string; readyToClose?: boolean };

/** 'Table 5' or 'Token T-012' in a coloured pill: whose order this is (REQ-093). */
export function ContextPill({ context }: { context: OrderContext }) {
  const { t } = useI18n();
  const main = context.kind === 'table' ? t('context.table', { number: context.table }) : t('context.token', { token: context.token });
  return (
    <div className={`context-pill context-pill--${context.kind}${context.readyToClose ? ' context-pill--ready-to-close' : ''}`} data-testid="context-pill" aria-live="polite">
      <span>{context.detail ? `${main} · ${context.detail}` : main}</span>
    </div>
  );
}
