import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ROLES, type Role } from '../../../common/auth/permissions';
import { NoContactInfo } from '../../../common/privacy/no-contact-info.validator';

export class ChangeRoleDto {
  @IsIn(ROLES)
  role!: Role;
}

/**
 * Justification for looking at someone else's data. Stored in the audit
 * log as-is, so it must say *why* ("disputa por carta no recibida, ticket
 * 42") without itself becoming a place to copy personal data into.
 */
export class AccessReasonDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  @NoContactInfo()
  reason!: string;
}

export class ResolvePseudonymDto extends AccessReasonDto {
  @Matches(/^u_[0-9a-f]{16}$/, {
    message: 'pseudonym must look like u_<16 hex chars>',
  })
  pseudonym!: string;
}

export class LimitQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
