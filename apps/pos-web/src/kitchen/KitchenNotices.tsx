import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useRealtime } from '../realtime/realtime';
import { kotNumberLabel } from './kitchenModel';

/** How long a notice chip stays before it fades out on its own. */
export const NOTICE_MS = 8_000;

interface Notice { id: number; kind: 'ready' | 'out'; text: string }

type Raw = Record<string, unknown>;
const s = (v: unknown) => (typeof v === 'string' && v ? v : null);

/**
 * Chips on cashier and admin screens: 'Food ready · Table 5' when the kitchen
 * marks a KOT Ready (REQ-052) and 'Out of stock: Dal' when it marks an item out
 * (REQ-056). Only an alert: the screens themselves refetch their data.
 */
export function KitchenNotices() {
  const { t, lang } = useI18n();
  const channel = useRealtime();
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    if (!channel) return;
    let seq = 0;
    const push = (kind: Notice['kind'], text: string) => {
      const id = ++seq;
      setNotices((n) => [...n.slice(-2), { id, kind, text }]);
      setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), NOTICE_MS);
    };
    const offReady = channel.on('kot.status_changed', (p) => {
      const k = (p ?? {}) as Raw;
      if (k.status !== 'READY') return;
      const token = s(k.token);
      const table = s(k.table_label) ?? s(k.table_label_snapshot);
      const who = token ?? (table ? t('kitchen.table', { number: table }) : t('kitchen.kotNumber', { number: kotNumberLabel(Number(k.kot_number) || 0) }));
      push('ready', t('kitchen.foodReady', { who }));
    });
    const offOut = channel.on('menu.availability_changed', (p) => {
      const i = (p ?? {}) as Raw;
      if (i.available_today !== false) return;
      const name = (lang === 'hi' && s(i.name_hi)) || s(i.name_en) || s(i.item_name);
      push('out', name ? t('kitchen.outNotice', { name }) : t('kitchen.outNoticeAny'));
    });
    return () => { offReady(); offOut(); };
  }, [channel, t, lang]);

  if (notices.length === 0) return null;
  return (
    <div className="kitchen-notices" role="status" aria-live="polite">
      {notices.map((n) => (
        <p key={n.id} className={`kitchen-notice kitchen-notice--${n.kind}`} data-testid={`notice-${n.kind}`}>
          <span aria-hidden="true">{n.kind === 'ready' ? '✓' : '✕'}</span>
          <span>{n.text}</span>
        </p>
      ))}
    </div>
  );
}
