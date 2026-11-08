import {
  addBusinessDays,
  blockingDenial,
  DENIAL_MESSAGES,
  dueDateFor,
  erasureBlockers,
  erasureMode,
  mailboxProofSuffices,
  requiresStepUp,
  type ErasureFacts,
} from './rights-policy';
import { OBJECTION_PURPOSES, isObjectionPurpose } from './objection-purposes';

// ROADMAP.md O15 / ACTIVIDAD_5.md §2 — the business rules behind each right.
describe('rights policy', () => {
  it('answers are due 30 calendar days after receipt (Ley 19.628, art. 11)', () => {
    const received = new Date('2026-10-23T12:00:00Z');
    expect(dueDateFor(received).toISOString()).toBe('2026-11-22T12:00:00.000Z');
  });

  describe('identity verification proportional to risk', () => {
    it.each([
      ['ACCESS', [], true],
      ['ERASURE', [], true],
      ['RECTIFICATION', ['email'], true],
      ['RECTIFICATION', ['displayName', 'email'], true],
      ['RECTIFICATION', ['displayName'], false],
      ['RECTIFICATION', ['language'], false],
      // O16: they only restrict processing and can be withdrawn.
      ['OBJECTION', [], false],
      ['BLOCKING', [], false],
    ] as const)('%s %j → step-up %s', (type, fields, expected) => {
      expect(requiresStepUp(type, [...fields])).toBe(expected);
    });
  });

  describe('erasure', () => {
    const clean: ErasureFacts = {
      pendingTransactions: 0,
      activeAuctionsAsSeller: 0,
      leadingBidsInActiveAuctions: 0,
      role: 'USER',
    };

    it('goes ahead when nothing ties the account to an open contract', () => {
      expect(erasureBlockers(clean)).toEqual([]);
    });

    it.each([
      [{ pendingTransactions: 1 }, 'OPEN_TRANSACTIONS'],
      [{ activeAuctionsAsSeller: 1 }, 'ACTIVE_AUCTION'],
      [{ leadingBidsInActiveAuctions: 2 }, 'ACTIVE_AUCTION'],
      [{ role: 'ADMIN' as const }, 'ADMIN_ROLE'],
      [{ role: 'SUPPORT' as const }, 'ADMIN_ROLE'],
    ])('is blocked by %j → %s', (facts, reason) => {
      expect(erasureBlockers({ ...clean, ...facts })).toContain(reason);
    });

    it('deletes the account outright when there is no transaction to keep', () => {
      expect(erasureMode(0)).toBe('delete');
    });

    it('tombstones it when closed transactions must be kept (tax obligation)', () => {
      expect(erasureMode(3)).toBe('tombstone');
    });
  });

  it('every denial reason has a message for the player (a denial must be grounded)', () => {
    for (const msg of Object.values(DENIAL_MESSAGES))
      expect(msg.length).toBeGreaterThan(20);
  });

  // ── O16 / ACTIVIDAD_6.md ────────────────────────────────────────────────

  describe('deadlines', () => {
    it('blocking is answered within 2 business days (art. 11)', () => {
      // Thursday → Monday (skips the weekend).
      const thu = new Date('2026-11-05T15:00:00Z');
      expect(dueDateFor(thu, 'BLOCKING').toISOString()).toBe(
        '2026-11-09T15:00:00.000Z',
      );
    });

    it('a Friday request is due on Tuesday', () => {
      expect(
        addBusinessDays(new Date('2026-11-06T10:00:00Z'), 2).toISOString(),
      ).toBe('2026-11-10T10:00:00.000Z');
    });

    it('objection keeps the general 30-day deadline', () => {
      const d = new Date('2026-11-07T00:00:00Z');
      expect(dueDateFor(d, 'OBJECTION').toISOString()).toBe(
        '2026-12-07T00:00:00.000Z',
      );
    });
  });

  describe('public form: what the mailbox proof is enough for', () => {
    it.each([
      ['OBJECTION', true],
      ['ACCESS', false],
      ['ERASURE', false],
      ['RECTIFICATION', false],
    ] as const)('%s → %s', (type, expected) => {
      expect(mailboxProofSuffices(type)).toBe(expected);
    });
  });

  describe('objection catalog (art. 8)', () => {
    it('upholds the sales statistics objection and denies security monitoring', () => {
      expect(OBJECTION_PURPOSES.SALES_STATISTICS.decision).toBe('UPHOLD');
      expect(OBJECTION_PURPOSES.SECURITY_MONITORING.decision).toBe('DENY');
    });

    it('only lists legitimate-interest processing', () => {
      for (const p of Object.values(OBJECTION_PURPOSES))
        expect(p.legalBasis).toMatch(/Interés legítimo/);
    });

    it('rejects contract- or consent-based purposes as objection targets', () => {
      expect(isObjectionPurpose('LOCATION_DISTANCE')).toBe(false);
      expect(isObjectionPurpose('ACCOUNT')).toBe(false);
      expect(isObjectionPurpose('SALES_STATISTICS')).toBe(true);
    });

    it('a denial carries its grounds', () => {
      expect(OBJECTION_PURPOSES.SECURITY_MONITORING.effect).toMatch(
        /motivos legítimos imperiosos/,
      );
    });
  });

  describe('blocking (art. 8 ter)', () => {
    it('is always possible as an alternative to erasure', () => {
      expect(blockingDenial('ALTERNATIVE_TO_ERASURE', null)).toBeNull();
    });

    it.each([
      [{ type: 'ERASURE', status: 'PENDING_STEP_UP' }, null],
      [{ type: 'RECTIFICATION', status: 'IN_EVALUATION' }, null],
      [{ type: 'OBJECTION', status: 'VERIFIED' }, null],
      [{ type: 'ERASURE', status: 'CLOSED' }, 'NO_PENDING_REQUEST'],
      [{ type: 'ACCESS', status: 'PENDING_STEP_UP' }, 'NO_PENDING_REQUEST'],
      // nobody has proven they are the holder yet
      [
        { type: 'ERASURE', status: 'AWAITING_CONFIRMATION' },
        'NO_PENDING_REQUEST',
      ],
    ] as const)('pending request %j → %s', (related, expected) => {
      expect(blockingDenial('PENDING_REQUEST', related)).toBe(expected);
    });

    it('needs the related request to exist (and be the holder’s own)', () => {
      expect(blockingDenial('PENDING_REQUEST', null)).toBe(
        'NO_PENDING_REQUEST',
      );
    });
  });
});
