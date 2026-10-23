export const AUDIT_RECORDED_EVENT = 'audit.recorded';

/**
 * ROADMAP.md O15 — emitted (and awaited) by AuditService after every audit
 * row is written, so SecurityService's detection rules run off the same
 * stream of events the log records, without every module having to call
 * the detector itself. In-process only: actorId is the raw id because the
 * containment action (a temporary lock) needs it; it never reaches the
 * database through this event.
 */
export class AuditRecordedEvent {
  constructor(
    public readonly action: string,
    public readonly outcome: string,
    public readonly actorId: string,
    public readonly actorPseudonym: string,
    public readonly targetPseudonym: string | null,
  ) {}
}
