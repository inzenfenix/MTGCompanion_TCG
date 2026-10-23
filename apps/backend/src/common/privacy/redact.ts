/**
 * Keeping personal data out of logs and error output (ROADMAP.md O14,
 * docs/security/ACTIVIDAD_4.md §2/§4). Logs get shipped, retained and read
 * by more people than the database does, so they get *less* detail, never
 * more: an email becomes "v***@g***.com" — enough to tell two messages
 * apart while debugging delivery, not enough to identify or contact anyone.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 8+ digits, optionally separated by spaces/dashes/dots and with a leading
// "+" — Chilean phone numbers (9 digits, 11 with +56) and RUTs
// (12.345.678-9). 8, not 7, so a CLP price like "1.500.000" in a card
// description doesn't trip it.
const LONG_NUMBER_RE = /\+?\d(?:[\s.-]?\d){7,}/g;
// "Bearer <jwt>" / bare JWTs (three base64url segments).
const TOKEN_RE =
  /\b(?:Bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}***@${host[0] ?? ''}***${tld}`;
}

/** Masks emails and strips phone-like numbers and tokens from free text (log messages, error messages). */
export function redactPersonalData(text: string): string {
  return text
    .replace(TOKEN_RE, '[token]')
    .replace(EMAIL_RE, (m) => maskEmail(m))
    .replace(LONG_NUMBER_RE, '[número]');
}

/** True if free text carries contact data (email or a phone-like number) — see NoContactInfo. */
export function containsContactInfo(text: string): boolean {
  EMAIL_RE.lastIndex = 0;
  LONG_NUMBER_RE.lastIndex = 0;
  return EMAIL_RE.test(text) || LONG_NUMBER_RE.test(text);
}
