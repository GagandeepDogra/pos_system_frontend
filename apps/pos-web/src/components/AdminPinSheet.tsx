import { useRef, useState } from 'react';
import type { ApiResult } from '../api/client';
import { newIdempotencyKey } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';
import { PinPad } from './PinPad';

type CreateApproval = (key: string, body: { pin: string }) => Promise<ApiResult<{ approval_token: string; admin_id: string }>>;

interface Props {
  title: string;
  createApproval: CreateApproval;
  /** The Admin PIN was accepted: a single-use approval token valid for 2 minutes. */
  onApproved: (token: string, adminId: string) => void;
  onCancel: () => void;
}

/**
 * Admin PIN override pad (REQ-023, REQ-031): the owner types their PIN on the
 * cashier's phone; the server answers with a single-use approval token, and the
 * action that uses it records both user ids. A non-Admin PIN is rejected (403).
 */
export function AdminPinSheet({ title, createApproval, onApproved, onCancel }: Props) {
  const { t } = useI18n();
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  // One key per PIN entry; a retry of the same entry reuses it.
  const keyRef = useRef<string | null>(null);

  const submit = async (pin: string) => {
    setBusy(true);
    keyRef.current = newIdempotencyKey();
    const res = await createApproval(keyRef.current, { pin });
    setBusy(false);
    if (res.ok) {
      onApproved(res.data.approval_token, res.data.admin_id);
      return;
    }
    setShake((n) => n + 1);
    setMessage(res.status === 403 ? t('pin.notAdmin') : t(`errors.${res.error.code}`));
  };

  return (
    <div className="sheet-scrim">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="sheet__title">{title}</h2>
        <p className="muted">{t('pin.adminHelp')}</p>
        <PinPad label={t('pin.adminLabel')} onComplete={submit} shakeKey={shake} message={message} disabled={busy} />
        <button type="button" className="btn btn--block" onClick={onCancel}>{t('pin.cancel')}</button>
      </div>
    </div>
  );
}
