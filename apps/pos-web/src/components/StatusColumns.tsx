import type { KotStatus } from '@dhaba/shared';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { kotStatusClass } from './Status';

export interface StatusColumnData {
  status: KotStatus;
  count: number;
  children?: ReactNode;
}

/**
 * Kitchen board layout: NEW, PREPARING, READY side by side on a landscape tablet
 * (stacked on a phone). Cards are filled in by the kitchen board screen.
 */
export function StatusColumns({ columns }: { columns: StatusColumnData[] }) {
  const { t } = useI18n();
  return (
    <div className="status-columns" data-testid="status-columns">
      {columns.map((c) => {
        const cls = kotStatusClass(c.status);
        return (
          <section key={c.status} className={`status-column status-column--${cls}`} aria-labelledby={`col-${cls}`}>
            <div className="status-column__heading">
              <h2 className="status-column__title" id={`col-${cls}`}>{t(`kotStatus.${cls}`)}</h2>
              <span>{t('kitchen.tickets', { count: c.count })}</span>
            </div>
            {c.children}
          </section>
        );
      })}
    </div>
  );
}
