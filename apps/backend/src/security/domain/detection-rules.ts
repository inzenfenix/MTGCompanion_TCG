/**
 * Detection rules (ROADMAP.md O15, ACTIVIDAD_5.md §4.2 — "criterios para
 * identificar un incidente"). Each rule watches the audit stream: when an
 * event matches, SecurityService counts how many events of the same kind
 * the same actor (pseudonym) produced inside the window, and raises an
 * alert at the threshold. Counting pseudonyms means detection works on the
 * same minimized data as the log — no IP, no email.
 *
 * Thresholds are deliberately conservative starting points for a small
 * marketplace, meant to be tuned in the "lecciones aprendidas" phase.
 */

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
export type Containment = 'lock-account' | 'revoke-sessions' | 'none';

export interface AuditSignal {
  action: string;
  outcome: string;
  actorPseudonym: string;
}

export interface DetectionRule {
  id: string;
  description: string;
  matches(e: AuditSignal): boolean;
  /** What is counted for the same actor inside the window. */
  count: { action: string; prefix?: boolean; outcome?: string };
  windowMinutes: number;
  threshold: number;
  severity: Severity;
  /** Automatic first containment step, applied when the alert is raised. */
  containment: Containment;
}

export const ANONYMOUS = 'anonymous';
export const LOCK_MINUTES = 15;

export const DETECTION_RULES: readonly DetectionRule[] = [
  {
    id: 'auth.bruteforce',
    description: 'Contraseñas incorrectas repetidas contra una misma cuenta',
    matches: (e) =>
      e.action === 'auth.login' &&
      e.outcome === 'FAILED' &&
      e.actorPseudonym !== ANONYMOUS,
    count: { action: 'auth.login', outcome: 'FAILED' },
    windowMinutes: 15,
    threshold: 5,
    severity: 'HIGH',
    containment: 'lock-account',
  },
  {
    id: 'auth.credential-stuffing',
    description:
      'Muchos intentos de inicio de sesión con correos que no existen',
    matches: (e) => e.action === 'auth.login' && e.actorPseudonym === ANONYMOUS,
    count: { action: 'auth.login' },
    windowMinutes: 5,
    threshold: 20,
    severity: 'HIGH',
    containment: 'none',
  },
  {
    id: 'auth.step-up.failures',
    description:
      'Una sesión válida falla repetidamente la reautenticación: probable sesión robada',
    matches: (e) => e.action === 'auth.step-up' && e.outcome === 'FAILED',
    count: { action: 'auth.step-up', outcome: 'FAILED' },
    windowMinutes: 15,
    threshold: 3,
    severity: 'HIGH',
    containment: 'revoke-sessions',
  },
  {
    id: 'data.export.burst',
    description: 'Exportaciones completas de datos repetidas en 24 h',
    matches: (e) => e.action === 'data.export' && e.outcome === 'ALLOWED',
    count: { action: 'data.export', outcome: 'ALLOWED' },
    windowMinutes: 24 * 60,
    threshold: 3,
    severity: 'MEDIUM',
    containment: 'none',
  },
  {
    id: 'support.read.burst',
    description:
      'Personal de soporte consultando transacciones de muchas cuentas',
    matches: (e) => e.action === 'support.transactions.read',
    count: { action: 'support.transactions.read' },
    windowMinutes: 60,
    threshold: 20,
    severity: 'MEDIUM',
    containment: 'none',
  },
  {
    id: 'access.denied.burst',
    description: 'Una cuenta sondea rutas administrativas sin permiso',
    matches: (e) => e.outcome === 'DENIED' && e.action.startsWith('denied '),
    count: { action: 'denied ', prefix: true, outcome: 'DENIED' },
    windowMinutes: 10,
    threshold: 5,
    severity: 'MEDIUM',
    containment: 'none',
  },
];

/** Raised directly by SecurityService.verifyAuditChain, not from the stream. */
export const AUDIT_CHAIN_RULE = 'audit.chain.broken';

/**
 * Alert lifecycle — the three levels the incident plan distinguishes
 * (ACTIVIDAD_5.md §4.2): OPEN = alerta (automatic), INVESTIGATING = evento
 * sospechoso (a human looked and it needs analysis), CONFIRMED = incidente
 * confirmado (the response plan starts). DISMISSED = false positive.
 */
export type AlertStatus =
  'OPEN' | 'INVESTIGATING' | 'CONFIRMED' | 'DISMISSED' | 'CLOSED';

const TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  OPEN: ['INVESTIGATING', 'CONFIRMED', 'DISMISSED'],
  INVESTIGATING: ['CONFIRMED', 'DISMISSED'],
  CONFIRMED: ['CLOSED'],
  DISMISSED: ['CLOSED'],
  CLOSED: [],
};

export function canTransition(from: AlertStatus, to: AlertStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
