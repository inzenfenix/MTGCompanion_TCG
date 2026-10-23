import type { AlertStatus, DetectionRule, Severity } from './detection-rules';

export interface SecurityAlertEntity {
  id: string;
  rule: string;
  severity: Severity;
  status: AlertStatus;
  subjectPseudonym: string | null;
  details: Record<string, unknown> | null;
  resolutionNote: string | null;
  handledBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SecurityRepository {
  /** Audit rows by this actor matching the rule's `count` filter since `since`. */
  countEvents(
    actorPseudonym: string,
    count: DetectionRule['count'],
    since: Date,
  ): Promise<number>;
  /** An OPEN/INVESTIGATING alert for the same rule + subject since `since` (dedupe). */
  findActive(
    rule: string,
    subjectPseudonym: string | null,
    since: Date,
  ): Promise<SecurityAlertEntity | null>;
  create(data: {
    rule: string;
    severity: Severity;
    subjectPseudonym: string | null;
    details: Record<string, unknown>;
  }): Promise<SecurityAlertEntity>;
  list(status?: AlertStatus, limit?: number): Promise<SecurityAlertEntity[]>;
  find(id: string): Promise<SecurityAlertEntity | null>;
  update(
    id: string,
    data: { status: AlertStatus; resolutionNote: string; handledBy: string },
  ): Promise<SecurityAlertEntity>;
}

export const SECURITY_REPOSITORY = Symbol('SECURITY_REPOSITORY');
