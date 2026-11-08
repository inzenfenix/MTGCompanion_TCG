import type { ChainVerification } from '../../common/audit/audit-chain';
import {
  auditEventDef,
  type DataCategory,
} from '../../common/audit/audit-events';

/**
 * Incident reconstruction from the audit log (ROADMAP.md O17,
 * ACTIVIDAD_7.md §6) — pure, so the API (GET /admin/security/incidents/
 * :alertId/timeline) and the offline script (npm run incident:timeline, for
 * when the API itself is the problem) produce the same reading.
 *
 * Input: the alert, every audit row in the window where the alert's subject
 * is the actor or the target (or the row is about the alert), and the
 * result of verifying the hash chain. Output: the events in order, each
 * tagged with the phase of the incident it belongs to, plus the summary the
 * response plan needs — who was affected, which categories of personal
 * data were touched (art. 14 sexies), what was attempted and denied, and
 * whether the log itself can be trusted.
 */

export type Phase =
  | 'ACCESO'
  | 'RECONOCIMIENTO'
  | 'ACCESO_A_DATOS'
  | 'MODIFICACION'
  | 'EXFILTRACION_O_DESTRUCCION'
  | 'DETECCION'
  | 'CONTENCION'
  | 'RECUPERACION'
  | 'OTRO';

export const PHASE_LABEL: Record<Phase, string> = {
  ACCESO: 'Acceso a la cuenta',
  RECONOCIMIENTO: 'Reconocimiento (intentos denegados)',
  ACCESO_A_DATOS: 'Acceso a datos personales',
  MODIFICACION: 'Modificación',
  EXFILTRACION_O_DESTRUCCION: 'Exfiltración o destrucción',
  DETECCION: 'Detección',
  CONTENCION: 'Contención',
  RECUPERACION: 'Recuperación',
  OTRO: 'Otro',
};

export interface TimelineRow {
  seq: string;
  createdAt: Date;
  actorPseudonym: string;
  actorRole: string | null;
  action: string;
  targetPseudonym: string | null;
  resourceType: string | null;
  resourceRef: string | null;
  reason: string | null;
  outcome: string;
}

export interface TimelineAlert {
  id: string;
  rule: string;
  severity: string;
  status: string;
  subjectPseudonym: string | null;
  createdAt: Date;
}

export function phaseOf(action: string, outcome: string): Phase {
  if (action === 'security.alert.raised') return 'DETECCION';
  if (
    action.startsWith('security.containment.') ||
    action === 'security.alert.update'
  )
    return 'CONTENCION';
  if (
    action.startsWith('security.recovery.') ||
    action === 'incident.snapshot' ||
    action === 'admin.audit.verify'
  )
    return 'RECUPERACION';
  if (outcome === 'DENIED' || outcome === 'FAILED') {
    if (action.startsWith('auth.')) return 'ACCESO';
    return 'RECONOCIMIENTO';
  }
  if (action === 'data.export' || action === 'data.erase')
    return 'EXFILTRACION_O_DESTRUCCION';
  const def = auditEventDef(action);
  if (action.startsWith('auth.') && def?.kind === 'AUTH') return 'ACCESO';
  if (def?.kind === 'READ') return 'ACCESO_A_DATOS';
  if (def?.kind === 'WRITE') return 'MODIFICACION';
  return 'OTRO';
}

export interface IncidentTimeline {
  alert: TimelineAlert;
  window: { from: Date; to: Date };
  chain: ChainVerification;
  /** false when the chain is broken: the reconstruction can't be trusted past brokenAt. */
  trustworthy: boolean;
  subject: string | null;
  summary: {
    events: number;
    firstEvent: Date | null;
    lastEvent: Date | null;
    byPhase: Partial<Record<Phase, number>>;
    deniedOrFailed: number;
    /** Other accounts whose data the subject read or changed (pseudonyms). */
    affectedSubjects: {
      pseudonym: string;
      events: number;
      actions: string[];
    }[];
    /** Inventory categories touched by ALLOWED reads/writes (art. 14 sexies). */
    dataCategories: DataCategory[];
    /** Every action, how often, and with which outcomes. */
    byAction: Record<string, Record<string, number>>;
    uncatalogued: string[];
  };
  events: (TimelineRow & { phase: Phase; personalData: DataCategory[] })[];
}

export function buildIncidentTimeline(input: {
  alert: TimelineAlert;
  rows: TimelineRow[];
  chain: ChainVerification;
  window: { from: Date; to: Date };
}): IncidentTimeline {
  const { alert, chain, window } = input;
  const subject = alert.subjectPseudonym;
  const rows = [...input.rows].sort((a, b) =>
    BigInt(a.seq) < BigInt(b.seq) ? -1 : 1,
  );
  const events = rows.map((r) => ({
    ...r,
    phase: phaseOf(r.action, r.outcome),
    personalData: auditEventDef(r.action)?.personalData ?? [],
  }));

  const byPhase: Partial<Record<Phase, number>> = {};
  const byAction: Record<string, Record<string, number>> = {};
  const affected = new Map<string, { events: number; actions: Set<string> }>();
  const categories = new Set<DataCategory>();
  const uncatalogued = new Set<string>();
  let deniedOrFailed = 0;

  for (const e of events) {
    byPhase[e.phase] = (byPhase[e.phase] ?? 0) + 1;
    byAction[e.action] ??= {};
    byAction[e.action][e.outcome] = (byAction[e.action][e.outcome] ?? 0) + 1;
    if (!auditEventDef(e.action)) uncatalogued.add(e.action);
    if (e.outcome !== 'ALLOWED') deniedOrFailed++;
    const bySubject = e.actorPseudonym === subject;
    if (bySubject && e.outcome === 'ALLOWED') {
      for (const c of e.personalData) categories.add(c);
    }
    if (
      bySubject &&
      e.targetPseudonym &&
      e.targetPseudonym !== subject &&
      !e.action.startsWith('security.')
    ) {
      const a = affected.get(e.targetPseudonym) ?? {
        events: 0,
        actions: new Set<string>(),
      };
      a.events++;
      a.actions.add(e.action);
      affected.set(e.targetPseudonym, a);
    }
  }

  return {
    alert,
    window,
    chain,
    trustworthy: chain.ok,
    subject,
    summary: {
      events: events.length,
      firstEvent: events[0]?.createdAt ?? null,
      lastEvent: events.at(-1)?.createdAt ?? null,
      byPhase,
      deniedOrFailed,
      affectedSubjects: [...affected.entries()]
        .map(([pseudonym, a]) => ({
          pseudonym,
          events: a.events,
          actions: [...a.actions].sort(),
        }))
        .sort((x, y) => y.events - x.events),
      dataCategories: [...categories].sort(),
      byAction,
      uncatalogued: [...uncatalogued].sort(),
    },
    events,
  };
}

const hhmmss = (d: Date) => d.toISOString().slice(11, 23);
const short = (p: string | null) =>
  p ? (p.startsWith('u_') ? p.slice(0, 14) : p) : '—';

/** Human-readable report, the same from the API (?format=md) and the script. */
export function renderTimelineMarkdown(t: IncidentTimeline): string {
  const s = t.summary;
  const lines = [
    `# Reconstrucción del incidente — alerta ${t.alert.id}`,
    '',
    `- Regla: \`${t.alert.rule}\` (${t.alert.severity}), estado ${t.alert.status}, levantada ${t.alert.createdAt.toISOString()}`,
    `- Sujeto (seudónimo): \`${t.subject ?? '—'}\``,
    `- Ventana: ${t.window.from.toISOString()} → ${t.window.to.toISOString()}`,
    `- Cadena de integridad: ${t.chain.ok ? `OK (${t.chain.checked} filas, seq ${t.chain.firstSeq}–${t.chain.lastSeq})` : `ROTA en seq ${t.chain.brokenAt?.seq} (${t.chain.brokenAt?.problem}) — la reconstrucción NO es confiable desde ahí`}`,
    `- Eventos: ${s.events} (${s.deniedOrFailed} denegados o fallidos), del ${s.firstEvent?.toISOString() ?? '—'} al ${s.lastEvent?.toISOString() ?? '—'}`,
    `- Categorías de datos personales tocadas: ${s.dataCategories.join(', ') || 'ninguna'}`,
    `- Otras cuentas afectadas: ${s.affectedSubjects.length === 0 ? 'ninguna' : s.affectedSubjects.map((a) => `\`${short(a.pseudonym)}\` (${a.events}: ${a.actions.join(', ')})`).join('; ')}`,
    ...(s.uncatalogued.length
      ? [`- Acciones fuera del catálogo: ${s.uncatalogued.join(', ')}`]
      : []),
    '',
    '## Por fase',
    '',
    '| Fase | Eventos |',
    '|---|---|',
    ...(Object.keys(PHASE_LABEL) as Phase[])
      .filter((p) => s.byPhase[p])
      .map((p) => `| ${PHASE_LABEL[p]} | ${s.byPhase[p]} |`),
    '',
    '## Línea de tiempo',
    '',
    '| seq | hora (UTC) | fase | actor | rol | acción | afectado | recurso | motivo | resultado |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...t.events.map(
      (e) =>
        `| ${e.seq} | ${hhmmss(e.createdAt)} | ${PHASE_LABEL[e.phase]} | ${short(e.actorPseudonym)} | ${e.actorRole ?? '—'} | ${e.action} | ${short(e.targetPseudonym)} | ${e.resourceType ?? ''}${e.resourceRef ? ` ${e.resourceRef.slice(0, 8)}` : ''} | ${(e.reason ?? '').replace(/\|/g, '/').slice(0, 60)} | ${e.outcome} |`,
    ),
  ];
  return lines.join('\n') + '\n';
}
