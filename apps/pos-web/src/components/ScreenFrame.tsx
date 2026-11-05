import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';

interface NavBarProps {
  /** Omitted on the dashboard (level 0): the slot stays so HOME never moves. */
  onBack?: () => void;
  onHome: () => void;
}

/** Large ← BACK and HOME, always in the same two slots (REQ-088). */
export function NavBar({ onBack, onHome }: NavBarProps) {
  const { t } = useI18n();
  return (
    <nav className="nav-bar" aria-label={t('nav.label')}>
      {onBack ? (
        <button type="button" className="btn" onClick={onBack}>
          {t('nav.back')}
        </button>
      ) : (
        <span className="nav-bar__placeholder" aria-hidden="true" />
      )}
      <button type="button" className="btn" onClick={onHome}>
        {t('nav.home')}
      </button>
    </nav>
  );
}

interface ScreenFrameProps extends NavBarProps {
  title: string;
  intro?: string;
  /** Connection line / clock, filled by the offline banner work. */
  status?: ReactNode;
  /** Order context pill, kept in the sticky header so it never scrolls away. */
  context?: ReactNode;
  /**
   * The one primary action of the screen (REQ-005): a single node, pinned at the bottom.
   * Screens never render a second primary button in the body.
   */
  primaryAction?: ReactNode;
  /** Small summary shown above the pinned action, e.g. '8 items · ₹580'. */
  actionSummary?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** The frame of every staff screen: header (status, HOME/BACK, context pill), body, pinned action. */
export function ScreenFrame({
  title, intro, status, context, primaryAction, actionSummary, onBack, onHome, className, children,
}: ScreenFrameProps) {
  return (
    <div className={`screen${primaryAction ? ' screen--has-action' : ''}${className ? ` ${className}` : ''}`}>
      <header className="screen__header">
        {status ? <div className="screen__status">{status}</div> : null}
        <NavBar onBack={onBack} onHome={onHome} />
        {context}
      </header>
      <main className="screen__body">
        <h1 className="heading">{title}</h1>
        {intro ? <p className="screen__intro">{intro}</p> : null}
        {children}
      </main>
      {primaryAction ? (
        <div className="pinned-action" data-testid="pinned-action">
          {actionSummary}
          {primaryAction}
        </div>
      ) : null}
    </div>
  );
}
