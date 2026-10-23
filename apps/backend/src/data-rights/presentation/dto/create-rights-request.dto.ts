import { Type } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { NoContactInfo } from '../../../common/privacy/no-contact-info.validator';

/**
 * The only fields a player can rectify, with exactly the same rules as at
 * registration (RegisterUserDto) — a correction can't sneak in a value
 * the system would have refused the first time.
 */
export class RectificationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @NoContactInfo()
  displayName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsIn(['en', 'es-LA', 'fr'])
  language?: string;
}

export class CreateRightsRequestDto {
  @IsIn(['ACCESS', 'RECTIFICATION', 'ERASURE'])
  type!: 'ACCESS' | 'RECTIFICATION' | 'ERASURE';

  // From POST /auth/step-up. Required for ACCESS, ERASURE and an email
  // change; checked (and consumed) by DataRightsService, not here.
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  stepUpToken?: string;

  @ValidateIf((o: CreateRightsRequestDto) => o.type === 'RECTIFICATION')
  @ValidateNested()
  @Type(() => RectificationDto)
  rectification?: RectificationDto;

  // Erasure can't be undone: the client must send an explicit `true`,
  // which the app only does after a confirmation dialog.
  @ValidateIf((o: CreateRightsRequestDto) => o.type === 'ERASURE')
  @Equals(true, { message: 'Erasure must be explicitly confirmed' })
  confirmErasure?: boolean;
}

export class ListRequestsQueryDto {
  @IsOptional()
  @IsIn(['RECEIVED', 'VERIFIED', 'IN_EVALUATION', 'CLOSED'])
  status?: 'RECEIVED' | 'VERIFIED' | 'IN_EVALUATION' | 'CLOSED';
}
