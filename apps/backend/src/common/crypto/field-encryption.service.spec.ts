import { randomBytes } from 'node:crypto';
import { assertProductionSecrets } from '../../config/configuration';
import { FieldEncryptionError, FieldEncryptionService } from './field-encryption.service';

const key = () => randomBytes(32).toString('base64');

describe('FieldEncryptionService (AES-256-GCM, ROADMAP.md O1)', () => {
  const k1 = key();
  const service = new FieldEncryptionService({ currentKeyId: 'v1', keys: { v1: k1 } });
  const totpSecret = 'JBSWY3DPEHPK3PXP';

  it('round-trips: decrypt(encrypt(x)) === x', () => {
    expect(service.decrypt(service.encrypt(totpSecret))).toBe(totpSecret);
  });

  it('stores v1:<iv>:<tag>:<ciphertext>, never the plaintext', () => {
    const envelope = service.encrypt(totpSecret);
    expect(envelope).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(envelope).not.toContain(totpSecret);
  });

  it('uses a fresh random IV: same value twice gives two different ciphertexts', () => {
    const a = service.encrypt(totpSecret);
    const b = service.encrypt(totpSecret);
    expect(a).not.toBe(b);
    expect(a.split(':')[1]).not.toBe(b.split(':')[1]);
    expect(service.decrypt(a)).toBe(service.decrypt(b));
  });

  it('rejects a tampered ciphertext (GCM authentication)', () => {
    const [id, iv, tag, ct] = service.encrypt(totpSecret).split(':');
    const bytes = Buffer.from(ct, 'base64');
    bytes[0] ^= 0x01; // flip one bit
    const tampered = [id, iv, tag, bytes.toString('base64')].join(':');
    expect(() => service.decrypt(tampered)).toThrow(FieldEncryptionError);
  });

  it('rejects a tampered auth tag', () => {
    const [id, iv, , ct] = service.encrypt(totpSecret).split(':');
    const tampered = [id, iv, randomBytes(16).toString('base64'), ct].join(':');
    expect(() => service.decrypt(tampered)).toThrow(FieldEncryptionError);
  });

  it('cannot be decrypted with a different key', () => {
    const other = new FieldEncryptionService({ currentKeyId: 'v1', keys: { v1: key() } });
    expect(() => other.decrypt(service.encrypt(totpSecret))).toThrow(FieldEncryptionError);
  });

  it('refuses plaintext where an envelope is expected', () => {
    expect(() => service.decrypt(totpSecret)).toThrow(FieldEncryptionError);
  });

  it('round-trips coordinates as numbers, nulls stay null', () => {
    expect(service.decryptNumber(service.encryptNumber(-33.4489))).toBe(-33.4489);
    expect(service.encryptNumber(null)).toBeNull();
    expect(service.decryptNullable(null)).toBeNull();
  });

  it('rejects keys that are not 32 bytes, without echoing the key', () => {
    const shortKey = randomBytes(16).toString('base64');
    expect(() => new FieldEncryptionService({ currentKeyId: 'v1', keys: { v1: shortKey } })).toThrow(
      /must be 32 bytes/,
    );
    try {
      new FieldEncryptionService({ currentKeyId: 'v1', keys: { v1: shortKey } });
    } catch (err) {
      expect((err as Error).message).not.toContain(shortKey);
    }
  });

  describe('key rotation', () => {
    const k2 = key();
    const rotated = new FieldEncryptionService({ currentKeyId: 'v2', keys: { v1: k1, v2: k2 } });

    it('still reads values written under the retired key', () => {
      expect(rotated.decrypt(service.encrypt(totpSecret))).toBe(totpSecret);
    });

    it('writes new values under the current key and flags old ones for re-encryption', () => {
      const old = service.encrypt(totpSecret);
      const fresh = rotated.encrypt(totpSecret);
      expect(fresh.startsWith('v2:')).toBe(true);
      expect(rotated.needsReencryption(old)).toBe(true);
      expect(rotated.needsReencryption(fresh)).toBe(false);
      expect(rotated.needsReencryption(totpSecret)).toBe(true); // legacy plaintext
    });
  });
});

describe('assertProductionSecrets (ROADMAP.md O4)', () => {
  it('refuses to boot in production without JWT_SECRET / FIELD_ENCRYPTION_KEY, naming only the variables', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'production' })).toThrow(
      /JWT_SECRET, FIELD_ENCRYPTION_KEY/,
    );
    expect(() =>
      assertProductionSecrets({ NODE_ENV: 'production', JWT_SECRET: 's3cret' }),
    ).toThrow(/FIELD_ENCRYPTION_KEY/);
  });

  it('boots in production when both are set, and never checks outside production', () => {
    expect(() =>
      assertProductionSecrets({ NODE_ENV: 'production', JWT_SECRET: 'x', FIELD_ENCRYPTION_KEY: key() }),
    ).not.toThrow();
    expect(() => assertProductionSecrets({ NODE_ENV: 'development' })).not.toThrow();
  });
});
