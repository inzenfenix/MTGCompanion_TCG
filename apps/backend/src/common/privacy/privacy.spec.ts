import { randomBytes, randomUUID } from 'node:crypto';
import { validate } from 'class-validator';
import { NoContactInfo } from './no-contact-info.validator';
import {
  AUDIT_SCOPE,
  bidScope,
  PseudonymKeyError,
  PseudonymService,
} from './pseudonym.service';
import { containsContactInfo, maskEmail, redactPersonalData } from './redact';

const key = () => randomBytes(32).toString('base64');

describe('PseudonymService (HMAC-SHA256, ROADMAP.md O14)', () => {
  const service = new PseudonymService(key());
  const userId = randomUUID();

  it('is stable: same id + scope → same pseudonym', () => {
    expect(service.pseudonymize(userId)).toBe(service.pseudonymize(userId));
  });

  it('looks like u_<16 hex> and never contains the id', () => {
    const p = service.pseudonymize(userId);
    expect(p).toMatch(/^u_[0-9a-f]{16}$/);
    expect(p).not.toContain(userId);
    expect(p).not.toContain(userId.slice(0, 8));
  });

  it('is scoped: the same bidder gets unlinkable aliases on two different auctions', () => {
    const a = service.pseudonymize(userId, bidScope(randomUUID()));
    const b = service.pseudonymize(userId, bidScope(randomUUID()));
    expect(a).not.toBe(b);
    expect(a).not.toBe(service.pseudonymize(userId, AUDIT_SCOPE));
  });

  it('is keyed: without the key the pseudonym cannot be recomputed', () => {
    const other = new PseudonymService(key());
    expect(other.pseudonymize(userId)).not.toBe(service.pseudonymize(userId));
  });

  it('resolve() re-identifies only with the key and the list of real ids', () => {
    const ids = [randomUUID(), userId, randomUUID()];
    const p = service.pseudonymize(userId);
    expect(service.resolve(p, ids)).toBe(userId);
    expect(service.resolve(p, [randomUUID()])).toBeNull();
    expect(new PseudonymService(key()).resolve(p, ids)).toBeNull();
  });

  it('refuses a short key, without echoing it', () => {
    const short = randomBytes(8).toString('base64');
    expect(() => new PseudonymService(short)).toThrow(PseudonymKeyError);
    try {
      new PseudonymService(short);
    } catch (e) {
      expect((e as Error).message).not.toContain(short);
    }
  });
});

describe('redaction for logs (ROADMAP.md O14)', () => {
  it('masks an email down to first letters + TLD', () => {
    expect(maskEmail('vicente.fuentes@gmail.com')).toBe('v***@g***.com');
    expect(maskEmail('not-an-email')).toBe('***');
  });

  it('redacts emails, phone numbers, RUTs and JWTs in free text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
    const out = redactPersonalData(
      `user ana@example.com phone +56 9 1234 5678 rut 12.345.678-9 token Bearer ${jwt}`,
    );
    expect(out).toContain('a***@e***.com');
    expect(out).not.toContain('ana@example.com');
    expect(out).not.toContain('1234 5678');
    expect(out).not.toContain('12.345.678');
    expect(out).not.toContain(jwt);
  });

  it('does not flag a CLP price as a phone number', () => {
    expect(containsContactInfo('Vendo a 1.500.000 CLP, casi NM')).toBe(false);
    expect(containsContactInfo('escríbeme al +56912345678')).toBe(true);
    expect(containsContactInfo('o a ana@example.com')).toBe(true);
  });
});

describe('@NoContactInfo() validator', () => {
  class Dto {
    @NoContactInfo()
    displayName!: string;
  }
  const check = async (displayName: string) => {
    const dto = Object.assign(new Dto(), { displayName });
    return (await validate(dto)).length;
  };

  it('accepts a plain alias', async () => {
    expect(await check('PlaneswalkerCL')).toBe(0);
  });

  it('rejects an alias carrying an email or a phone', async () => {
    expect(await check('ana@example.com')).toBe(1);
    expect(await check('Ana +56 9 8765 4321')).toBe(1);
  });
});
