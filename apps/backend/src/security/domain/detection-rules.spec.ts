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
});
