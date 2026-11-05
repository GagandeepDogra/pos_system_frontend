/**
 * Holds an Admin approval token on the cashier's device (REQ-023).
 * It is single use (take() hands it out once) and is dropped after 2 minutes,
 * matching the server's TTL; the server re-checks both.
 */
export const APPROVAL_TTL_MS = 2 * 60 * 1000;

export interface Approval {
  token: string;
  adminId: string;
  issuedAt: number;
}

export function createApprovalHolder(now: () => number = Date.now) {
  let current: Approval | null = null;
  return {
    put(token: string, adminId: string) {
      current = { token, adminId, issuedAt: now() };
    },
    /** Returns the token for ONE action and forgets it; null if none or expired. */
    take(): string | null {
      const a = current;
      current = null;
      if (!a || now() - a.issuedAt >= APPROVAL_TTL_MS) return null;
      return a.token;
    },
    peek(): Approval | null {
      if (current && now() - current.issuedAt >= APPROVAL_TTL_MS) current = null;
      return current;
    },
  };
}

export type ApprovalHolder = ReturnType<typeof createApprovalHolder>;
