import {
  buildIncidentTimeline,
  phaseOf,
  renderTimelineMarkdown,
  type TimelineRow,
} from './incident-timeline';

// ROADMAP.md O17 / ACTIVIDAD_7.md §6 — reconstruction from the log alone.
describe('incident timeline', () => {
  const S = 'u_victim000000000';
  const OTHER = 'u_other00000000000';
  let seq = 0;
  const row = (
    action: string,
    outcome = 'ALLOWED',
    extra: Partial<TimelineRow> = {},
  ): TimelineRow => ({
    seq: String(++seq),
    createdAt: new Date(Date.UTC(2026, 10, 7, 12, 0, seq)),
    actorPseudonym: S,
    actorRole: 'USER',
    action,
    targetPseudonym: null,
    resourceType: null,
    resourceRef: null,
    reason: null,
    outcome,
    ...extra,
  });

  it.each([
    ['auth.login', 'ALLOWED', 'ACCESO'],
    ['auth.login', 'FAILED', 'ACCESO'],
    ['access.transaction.read', 'DENIED', 'RECONOCIMIENTO'],
    ['access.transaction.read', 'ALLOWED', 'ACCESO_A_DATOS'],
    ['access.location.distance', 'ALLOWED', 'ACCESO_A_DATOS'],
    ['data.rectify', 'ALLOWED', 'MODIFICACION'],
    ['data.export', 'ALLOWED', 'EXFILTRACION_O_DESTRUCCION'],
    ['security.alert.raised', 'ALLOWED', 'DETECCION'],
    ['security.containment.revoke-sessions', 'ALLOWED', 'CONTENCION'],
    ['security.recovery.enable', 'ALLOWED', 'RECUPERACION'],
    ['denied GET /admin/audit-logs', 'DENIED', 'RECONOCIMIENTO'],
  ])('%s (%s) → %s', (action, outcome, phase) => {
    expect(phaseOf(action, outcome)).toBe(phase);
  });

  const rows = [
    row('auth.login'),
    row('access.location.distance', 'ALLOWED', {
      reason: 'sellers=3;new-position',
    }),
    row('access.transaction.read', 'DENIED', { reason: 'forbidden' }),
    row('access.transaction.read', 'ALLOWED', { targetPseudonym: OTHER }),
    row('data.rectify', 'ALLOWED', { targetPseudonym: S, reason: 'email' }),
    row('data.export', 'ALLOWED', { targetPseudonym: S }),
    row('security.alert.raised', 'ALLOWED', {
      actorPseudonym: 'system',
      actorRole: null,
      targetPseudonym: S,
      resourceRef: 'alert-1',
    }),
  ];
  const alert = {
    id: 'alert-1',
    rule: 'account.takeover.sequence',
    severity: 'HIGH',
    status: 'OPEN',
    subjectPseudonym: S,
    createdAt: new Date(Date.UTC(2026, 10, 7, 12, 0, 7)),
  };
  const ok = { ok: true, checked: 7, firstSeq: '1', lastSeq: '7' };
  const window = { from: new Date(0), to: new Date(Date.UTC(2030, 0, 1)) };

  it('summarizes phases, affected accounts and data categories', () => {
    const t = buildIncidentTimeline({
      alert,
      rows: [...rows].reverse(),
      chain: ok,
      window,
    });
    expect(t.events.map((e) => e.seq)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
    expect(t.summary.byPhase).toMatchObject({
      ACCESO: 1,
      ACCESO_A_DATOS: 2,
      RECONOCIMIENTO: 1,
      MODIFICACION: 1,
      EXFILTRACION_O_DESTRUCCION: 1,
      DETECCION: 1,
    });
    expect(t.summary.affectedSubjects).toEqual([
      { pseudonym: OTHER, events: 1, actions: ['access.transaction.read'] },
    ]);
    expect(t.summary.dataCategories).toEqual(
      expect.arrayContaining([
        'geolocalización',
        'transacciones',
        'identificación',
      ]),
    );
    expect(t.summary.deniedOrFailed).toBe(1);
    expect(t.trustworthy).toBe(true);
  });

  it('a broken chain is reported, not hidden', () => {
    const t = buildIncidentTimeline({
      alert,
      rows,
      chain: {
        ...ok,
        ok: false,
        brokenAt: { seq: '4', problem: 'hash-mismatch' },
      },
      window,
    });
    expect(t.trustworthy).toBe(false);
    expect(renderTimelineMarkdown(t)).toMatch(/ROTA en seq 4/);
  });

  it('flags actions outside the catalog', () => {
    const t = buildIncidentTimeline({
      alert,
      rows: [row('mystery.action')],
      chain: ok,
      window,
    });
    expect(t.summary.uncatalogued).toEqual(['mystery.action']);
  });

  it('renders a markdown report with one line per event', () => {
    const md = renderTimelineMarkdown(
      buildIncidentTimeline({ alert, rows, chain: ok, window }),
    );
    expect(md).toMatch(/Exfiltración o destrucción/);
    expect(md.split('\n').filter((l) => /^\| \d+ \|/.test(l))).toHaveLength(7);
  });
});
