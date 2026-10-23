import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Pseudonymization (ROADMAP.md O14, docs/security/ACTIVIDAD_4.md §2): turns
 * a direct identifier (a user id) into a stable code that says nothing about
 * the person on its own.
 *
 *   pseudonym = "u_" + first 16 hex chars of HMAC-SHA256(PSEUDONYM_KEY, scope + ":" + userId)
 *
 * - Keyed (HMAC, not a bare hash): user ids are UUIDs anyone with a listing
 *   or a transaction in hand already knows, so an unkeyed SHA-256(userId)
 *   could be reversed just by hashing every known id. Without the key,
 *   the pseudonym can't be recomputed or reversed.
 * - Scoped: the same user gets a different pseudonym per scope. "audit" is
 *   one global scope (so an ADMIN can follow one actor across log entries);
 *   bidder aliases use "bid:<cardId>", so a bidder can't be tracked from
 *   one auction to the next by their alias.
 * - Still personal data: whoever has the key *and* the users table can link
 *   it back (that's what resolve() does), which is exactly why this is
 *   pseudonymization and not anonymization. The key lives only in the
 *   backend's environment (AWS Secrets Manager in prod), separate from
 *   FIELD_ENCRYPTION_KEY, and resolve() is only reachable by an ADMIN.
 */

const KEY_MIN_BYTES = 32;
const PSEUDONYM_HEX_CHARS = 16; // 64 bits — collision-safe for this app's user count

export const AUDIT_SCOPE = 'audit';
export const bidScope = (cardId: string) => `bid:${cardId}`;

export class PseudonymKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PseudonymKeyError';
  }
}

export class PseudonymService {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    // Never echo the key in an error — only its length.
    if (key.length < KEY_MIN_BYTES) {
      throw new PseudonymKeyError(
        `PSEUDONYM_KEY must be at least ${KEY_MIN_BYTES} bytes base64-encoded (got ${key.length}). ` +
          'Generate one with: openssl rand -base64 32',
      );
    }
    this.key = key;
  }

  /**
   * A separate 32-byte key for another purpose (HKDF-SHA256, `label` as
   * info) — e.g. the audit log's hash chain (O15). Derived rather than a new
   * secret so deploys don't need another Secrets Manager entry, while still
   * never using the same key bytes for two different jobs.
   */
  deriveKey(label: string): Buffer {
    return Buffer.from(
      hkdfSync('sha256', this.key, Buffer.alloc(0), label, 32),
    );
  }

  pseudonymize(userId: string, scope: string = AUDIT_SCOPE): string {
    const mac = createHmac('sha256', this.key)
      .update(`${scope}:${userId}`)
      .digest('hex');
    return `u_${mac.slice(0, PSEUDONYM_HEX_CHARS)}`;
  }

  /**
   * Re-identification: which of `candidateIds` produced this pseudonym.
   * HMAC is one-way, so this recomputes the pseudonym for each candidate —
   * which is the point: it only works for someone holding both the key and
   * the list of real ids (the users table).
   */
  resolve(
    pseudonym: string,
    candidateIds: Iterable<string>,
    scope: string = AUDIT_SCOPE,
  ): string | null {
    const wanted = Buffer.from(pseudonym);
    for (const id of candidateIds) {
      const candidate = Buffer.from(this.pseudonymize(id, scope));
      if (
        candidate.length === wanted.length &&
        timingSafeEqual(candidate, wanted)
      ) {
        return id;
      }
    }
    return null;
  }
}
