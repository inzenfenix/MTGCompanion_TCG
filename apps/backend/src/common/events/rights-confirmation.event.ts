export const RIGHTS_CONFIRMATION_EVENT = 'data-rights.confirmation';

/**
 * ROADMAP.md O16 (ACTIVIDAD_6.md §1–2) — a request arrived through the
 * public form for an address that has an account. The single-use code goes
 * to that address — the only proof of identity the form can get — and
 * nothing is processed until it comes back. Whoever filled the form only
 * learns "if the address exists, check your inbox", whatever the case.
 */
export class RightsConfirmationEvent {
  constructor(
    public readonly email: string,
    public readonly displayName: string,
    public readonly requestId: string,
    public readonly type: string,
    /** The plain single-use code (only its SHA-256 is stored). */
    public readonly code: string,
    public readonly expiresAt: Date,
  ) {}
}
