import { IsIn, IsOptional } from 'class-validator';
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
