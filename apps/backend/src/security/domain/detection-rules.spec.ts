import { canTransition, DETECTION_RULES } from './detection-rules';

const rule = (id: string) => DETECTION_RULES.find((r) => r.id === id)!;

// ROADMAP.md O15 / ACTIVIDAD_5.md §4.2 — incident criteria.
describe('detection rules', () => {
  it('rule ids are unique', () => {
    const ids = DETECTION_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    [
      'auth.bruteforce',
      { action: 'auth.login', outcome: 'FAILED', actorPseudonym: 'u_1' },
      true,
    ],
    [
      'auth.bruteforce',
      { action: 'auth.login', outcome: 'FAILED', actorPseudonym: 'anonymous' },
      false,
    ],
    [
      'auth.bruteforce',
      { action: 'auth.login', outcome: 'ALLOWED', actorPseudonym: 'u_1' },
      false,
    ],
    [
      'auth.credential-stuffing',
      { action: 'auth.login', outcome: 'DENIED', actorPseudonym: 'anonymous' },
      true,
    ],
    [
      'auth.step-up.failures',
      { action: 'auth.step-up', outcome: 'FAILED', actorPseudonym: 'u_1' },
      true,
    ],
    [
      'data.export.burst',
      { action: 'data.export', outcome: 'ALLOWED', actorPseudonym: 'u_1' },
      true,
    ],
    [
      'data.export.burst',
      { action: 'data.export', outcome: 'DENIED', actorPseudonym: 'u_1' },
      false,
    ],
    [
      'access.denied.burst',
      {
        action: 'denied GET /admin/audit-logs',
        outcome: 'DENIED',
        actorPseudonym: 'u_1',
      },
      true,
    ],
    [
      'access.denied.burst',
      { action: 'auth.login', outcome: 'DENIED', actorPseudonym: 'u_1' },
      false,
    ],
  ])('%s matches %j → %s', (id, signal, expected) => {
    expect(rule(id).matches(signal)).toBe(expected);
  });

  it('automatic containment is reversible and proportionate — never deletes anything', () => {
    for (const r of DETECTION_RULES) {
      expect(['lock-account', 'revoke-sessions', 'none']).toContain(
        r.containment,
      );
    }
    expect(rule('auth.bruteforce').containment).toBe('lock-account');
    expect(rule('auth.step-up.failures').containment).toBe('revoke-sessions');
  });

  describe('alert lifecycle (alerta → evento sospechoso → incidente)', () => {
    it.each([
      ['OPEN', 'INVESTIGATING', true],
      ['INVESTIGATING', 'CONFIRMED', true],
      ['CONFIRMED', 'CLOSED', true],
      ['OPEN', 'DISMISSED', true],
      ['OPEN', 'CLOSED', false],
      ['CLOSED', 'OPEN', false],
      ['DISMISSED', 'CONFIRMED', false],
    ] as const)('%s → %s allowed: %s', (from, to, ok) => {
      expect(canTransition(from, to)).toBe(ok);
    });
  });

  // ── O17 (ACTIVIDAD_7.md §4): alerts specific to this system ────────────
  describe('system-specific rules', () => {
    const sig = (action: string, outcome = 'ALLOWED') => ({
      action,
      outcome,
      actorPseudonym: 'u_1',
    });

    it.each([
      ['bazaar.location.triangulation', sig('access.location.distance'), true],
      [
        'bazaar.location.triangulation',
        sig('access.location.distance', 'DENIED'),
        false,
      ],
      ['account.takeover.sequence', sig('data.export'), true],
      ['account.takeover.sequence', sig('data.erase'), true],
      ['account.takeover.sequence', sig('data.export', 'DENIED'), false],
      [
        'transactions.enumeration',
        sig('access.transaction.read', 'DENIED'),
        true,
      ],
      ['transactions.enumeration', sig('access.receipt.read', 'DENIED'), true],
      ['transactions.enumeration', sig('access.transaction.read'), false],
      ['admin.reidentification.burst', sig('admin.pseudonym.resolve'), true],
    ])('%s matches %j → %s', (id, e, expected) => {
      expect(rule(id).matches(e)).toBe(expected);
    });

    it('the takeover rule is a sequence: it fires on an export but counts earlier email changes', () => {
      const r = rule('account.takeover.sequence');
      expect(r.count).toEqual({
        action: 'data.rectify',
        outcome: 'ALLOWED',
        reasonContains: 'email',
      });
      expect(r.threshold).toBe(1);
      expect(r.windowMinutes).toBe(60);
    });

    it('triangulation counts jumps between positions, not plain searches', () => {
      expect(rule('bazaar.location.triangulation').count.reasonContains).toBe(
        'new-position',
      );
    });

    it('high-severity session-level threats contain automatically; staff abuse goes to a human', () => {
      expect(rule('bazaar.location.triangulation').containment).toBe(
        'revoke-sessions',
      );
      expect(rule('account.takeover.sequence').containment).toBe(
        'revoke-sessions',
      );
      expect(rule('admin.reidentification.burst').containment).toBe('none');
    });
  });
});
