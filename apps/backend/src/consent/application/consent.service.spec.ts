import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AuditService } from '../../common/audit/audit.service';
import { CONSENT_PURPOSES } from '../domain/consent-purposes';
import type {
  ConsentChange,
  ConsentRecord,
  ConsentRepository,
} from '../domain/consent.repository';
import { ConsentService } from './consent.service';

class InMemoryConsents implements ConsentRepository {
  rows = new Map<string, ConsentRecord>();
  changes: ConsentChange[] = [];
  private k = (u: string, p: string) => `${u}:${p}`;
  findForUser(userId: string) {
    return Promise.resolve(
      [...this.rows.entries()]
        .filter(([k]) => k.startsWith(`${userId}:`))
        .map(([, v]) => v),
    );
  }
  find(userId: string, purpose: string) {
    return Promise.resolve(this.rows.get(this.k(userId, purpose)) ?? null);
  }
  history() {
    return Promise.resolve([]);
  }
  apply(c: ConsentChange) {
    this.changes.push(c);
    const prev = this.rows.get(this.k(c.userId, c.purpose));
    const rec: ConsentRecord = {
      purpose: c.purpose,
      version: c.version,
      status: c.status,
      grantedAt: c.status === 'GRANTED' ? c.at : (prev?.grantedAt ?? c.at),
      revokedAt: c.status === 'REVOKED' ? c.at : null,
    };
    this.rows.set(this.k(c.userId, c.purpose), rec);
    return Promise.resolve(rec);
  }
}

// ROADMAP.md O15 / ACTIVIDAD_5.md §1 — the consent rules, without a database.
describe('ConsentService', () => {
  let repo: InMemoryConsents;
  let service: ConsentService;
  const record = jest.fn().mockResolvedValue(undefined);
  const alice = { id: 'alice', role: 'USER' as const };
  const v = (p: keyof typeof CONSENT_PURPOSES) => CONSENT_PURPOSES[p].version;

  beforeEach(() => {
    repo = new InMemoryConsents();
    record.mockClear();
    service = new ConsentService(repo, { record } as unknown as AuditService);
  });

  it('nothing is consented by default (fails closed)', async () => {
    for (const p of Object.keys(
      CONSENT_PURPOSES,
    ) as (keyof typeof CONSENT_PURPOSES)[]) {
      expect(await service.hasConsent('alice', p)).toBe(false);
    }
  });

  it('a consent for one purpose never enables another', async () => {
    await service.grantFromApp(
      alice,
      'LOCATION_DISTANCE',
      v('LOCATION_DISTANCE'),
    );
    expect(await service.hasConsent('alice', 'LOCATION_DISTANCE')).toBe(true);
    expect(await service.hasConsent('alice', 'EMAIL_NOTIFICATIONS')).toBe(
      false,
    );
    expect(await service.hasConsent('alice', 'TWO_FACTOR')).toBe(false);
    expect(await service.hasConsent('bob', 'LOCATION_DISTANCE')).toBe(false);
  });

  it('revocation takes effect immediately and keeps the grant date', async () => {
    await service.grantFromApp(
      alice,
      'EMAIL_NOTIFICATIONS',
      v('EMAIL_NOTIFICATIONS'),
    );
    const view = await service.revokeFromApp(alice, 'EMAIL_NOTIFICATIONS');
    expect(view).toMatchObject({ status: 'REVOKED', effective: false });
    expect(view.grantedAt).not.toBeNull();
    expect(view.revokedAt).not.toBeNull();
    expect(await service.hasConsent('alice', 'EMAIL_NOTIFICATIONS')).toBe(
      false,
    );
  });

  it('repeating a grant or a revocation writes nothing new (idempotent)', async () => {
    await service.grantFromApp(
      alice,
      'LOCATION_DISTANCE',
      v('LOCATION_DISTANCE'),
    );
    await service.grantFromApp(
      alice,
      'LOCATION_DISTANCE',
      v('LOCATION_DISTANCE'),
    );
    await service.revokeFromApp(alice, 'LOCATION_DISTANCE');
    await service.revokeFromApp(alice, 'LOCATION_DISTANCE');
    expect(repo.changes.map((c) => c.status)).toEqual(['GRANTED', 'REVOKED']);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('a consent to an older text version does not count', async () => {
    await service.grantFromApp(
      alice,
      'LOCATION_DISTANCE',
      v('LOCATION_DISTANCE'),
    );
    repo.rows.get('alice:LOCATION_DISTANCE')!.version = '0';
    expect(await service.hasConsent('alice', 'LOCATION_DISTANCE')).toBe(false);
    const [view] = (await service.listForUser('alice')).filter(
      (c) => c.purpose === 'LOCATION_DISTANCE',
    );
    expect(view).toMatchObject({ requiresReconsent: true, effective: false });
  });

  it('the client must accept the current version of the text', async () => {
    await expect(
      service.grantFromApp(alice, 'LOCATION_DISTANCE', '999'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('unknown purposes and flow-managed ones are refused', async () => {
    await expect(
      service.grantFromApp(alice, 'MARKETING', '1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.grantFromApp(alice, 'TWO_FACTOR', v('TWO_FACTOR')),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('each change stores the hash of the exact text shown, and is audited without personal data', async () => {
    await service.grantFromApp(
      alice,
      'LOCATION_DISTANCE',
      v('LOCATION_DISTANCE'),
    );
    expect(repo.changes[0].textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consent.grant',
        resourceType: 'consent',
        resourceRef: 'LOCATION_DISTANCE',
      }),
    );
  });
});
