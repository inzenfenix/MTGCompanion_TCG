import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Field-level encryption for personal data that the backend must be able to
 * read back (ROADMAP.md O1, docs/security/CIFRADO_CAMPOS.md §3) — the TOTP
 * secret and the last known location. Values that only need to be
 * *compared* (passwords, refresh tokens) are hashed instead and never go
 * through here.
 *
 * AES-256-GCM via node:crypto: authenticated encryption, so a tampered
 * ciphertext (or one decrypted with the wrong key) fails loudly instead of
 * returning garbage. Stored format, all one TEXT column:
 *
 *   <keyId>:<iv base64>:<auth tag base64>:<ciphertext base64>
 *   e.g. v1:5d1x...:Qm9o...:4FvA...
 *
 * - IV: 12 random bytes per encrypt() call, never reused — encrypting the
 *   same value twice gives two different ciphertexts.
 * - keyId: which key encrypted it, so keys can be rotated: new writes use
 *   the current key, old values still decrypt with a retired key until the
 *   re-encryption script (src/scripts/encrypt-existing-fields.ts) rewrites them.
 *
 * Only infrastructure-layer repositories call this. Domain/application code
 * keeps seeing plaintext; the database only ever sees the envelope above.
 * The key itself never lives in the code or next to the data — it comes
 * from FIELD_ENCRYPTION_KEY (AWS Secrets Manager in prod, gitignored .env in
 * dev), see config/configuration.ts.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_RE = /^v\d+$/;
const ENVELOPE_RE = /^(v\d+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]*)$/;

export interface FieldEncryptionKeyring {
  /** Key id used for every new encryption, e.g. "v2". */
  currentKeyId: string;
  /** Every usable key (current + retired), base64-encoded 32-byte values, by id. */
  keys: Record<string, string>;
}

export class FieldEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldEncryptionError';
  }
}

export class FieldEncryptionService {
  private readonly currentKeyId: string;
  private readonly keys: Map<string, Buffer>;

  constructor(keyring: FieldEncryptionKeyring) {
    this.keys = new Map();
    for (const [id, b64] of Object.entries(keyring.keys)) {
      if (!KEY_ID_RE.test(id)) {
        throw new FieldEncryptionError(`Invalid key id "${id}" (expected v<number>, e.g. v1)`);
      }
      const key = Buffer.from(b64, 'base64');
      // Never echo the key itself in an error — only its id and length.
      if (key.length !== KEY_BYTES) {
        throw new FieldEncryptionError(
          `Field encryption key ${id} must be ${KEY_BYTES} bytes base64-encoded (got ${key.length} bytes). ` +
            'Generate one with: openssl rand -base64 32',
        );
      }
      this.keys.set(id, key);
    }
    if (!this.keys.has(keyring.currentKeyId)) {
      throw new FieldEncryptionError(
        `No field encryption key configured for current key id "${keyring.currentKeyId}"`,
      );
    }
    this.currentKeyId = keyring.currentKeyId;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.keys.get(this.currentKeyId)!, iv, {
      authTagLength: TAG_BYTES,
    });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      this.currentKeyId,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  decrypt(envelope: string): string {
    const match = ENVELOPE_RE.exec(envelope);
    if (!match) {
      throw new FieldEncryptionError('Value is not an encrypted field envelope');
    }
    const [, keyId, ivB64, tagB64, ctB64] = match;
    const key = this.keys.get(keyId);
    if (!key) {
      throw new FieldEncryptionError(`No key configured for key id "${keyId}"`);
    }
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new FieldEncryptionError('Malformed encrypted field envelope');
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(ctB64, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // GCM tag mismatch: ciphertext/iv/tag altered, or encrypted under a
      // different key that happens to share this id.
      throw new FieldEncryptionError('Encrypted field failed authentication (tampered or wrong key)');
    }
  }

  /** True if the value is already an envelope (any configured or unknown key id). */
  isEncrypted(value: string): boolean {
    return ENVELOPE_RE.test(value);
  }

  /** True if the value is plaintext or was encrypted with a key other than the current one. */
  needsReencryption(value: string): boolean {
    const match = ENVELOPE_RE.exec(value);
    return !match || match[1] !== this.currentKeyId;
  }

  encryptNullable(plaintext: string | null | undefined): string | null {
    return plaintext == null ? null : this.encrypt(plaintext);
  }

  decryptNullable(envelope: string | null | undefined): string | null {
    return envelope == null ? null : this.decrypt(envelope);
  }

  encryptNumber(value: number | null | undefined): string | null {
    return value == null ? null : this.encrypt(String(value));
  }

  decryptNumber(envelope: string | null | undefined): number | null {
    if (envelope == null) return null;
    const value = Number(this.decrypt(envelope));
    if (!Number.isFinite(value)) {
      throw new FieldEncryptionError('Encrypted numeric field did not decrypt to a number');
    }
    return value;
  }
}
