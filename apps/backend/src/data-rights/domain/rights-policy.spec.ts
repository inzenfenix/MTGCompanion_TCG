import {
  DENIAL_MESSAGES,
  dueDateFor,
  erasureBlockers,
  erasureMode,
  requiresStepUp,
  type ErasureFacts,
} from './rights-policy';

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
});
