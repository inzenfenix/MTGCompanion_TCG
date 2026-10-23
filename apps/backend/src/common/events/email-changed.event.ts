export const EMAIL_CHANGED_EVENT = 'user.email-changed';

/**
 * ROADMAP.md O15 — a rectification changed the account's email. The
 * security notice goes to the *previous* address (the new one is already
 * in the hands of whoever made the change), and it's a contract-basis
 * security email, not an optional one: it doesn't depend on the
 * EMAIL_NOTIFICATIONS consent.
 */
export class EmailChangedEvent {
  constructor(
    public readonly previousEmail: string,
    public readonly displayName: string,
  ) {}
}
