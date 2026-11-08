import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AccessReasonDto } from '../../../admin/presentation/dto/admin.dto';
import type { AlertStatus } from '../../domain/detection-rules';

const STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'CONFIRMED',
  'DISMISSED',
  'CLOSED',
] as const;

/** Containment actions need a reason, same rules as support access (10–200 chars, no contact data). */
export class ContainmentDto extends AccessReasonDto {}

export class UpdateAlertDto extends AccessReasonDto {
  @IsIn(STATUSES)
  status!: AlertStatus;
}

export class AlertQueryDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: AlertStatus;
}

/** O17 — GET /admin/security/incidents/:alertId/timeline. */
export class TimelineQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 30)
  hoursBefore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 30)
  hoursAfter?: number;

  @IsOptional()
  @IsIn(['json', 'md'])
  format?: 'json' | 'md';
}
