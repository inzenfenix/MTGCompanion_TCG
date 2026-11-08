import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { NoContactInfo } from '../../../common/privacy/no-contact-info.validator';
import { OBJECTION_PURPOSE_CODES } from '../../domain/objection-purposes';
import { PUBLIC_FORM_TYPES } from '../../domain/rights-policy';

const RIGHTS_TYPES = [
  'ACCESS',
  'RECTIFICATION',
  'ERASURE',
  'OBJECTION',
  'BLOCKING',
] as const;
type RightsTypeInput = (typeof RIGHTS_TYPES)[number];

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

/** O16 — art. 8 ter: while a request is pending, or instead of erasure. */
export class BlockingDto {
  @IsIn(['PENDING_REQUEST', 'ALTERNATIVE_TO_ERASURE'])
  basis!: 'PENDING_REQUEST' | 'ALTERNATIVE_TO_ERASURE';

  @ValidateIf((o: BlockingDto) => o.basis === 'PENDING_REQUEST')
  @IsUUID()
  relatedRequestId?: string;
}

export class CreateRightsRequestDto {
  @IsIn(RIGHTS_TYPES)
  type!: RightsTypeInput;

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

  // O16 — OBJECTION: which processing (objection-purposes.ts). Anything not
  // in the catalog (contract- or consent-based processing) is a 400.
  @ValidateIf((o: CreateRightsRequestDto) => o.type === 'OBJECTION')
  @IsIn(OBJECTION_PURPOSE_CODES)
  purpose?: (typeof OBJECTION_PURPOSE_CODES)[number];

  @ValidateIf((o: CreateRightsRequestDto) => o.type === 'BLOCKING')
  @ValidateNested()
  @Type(() => BlockingDto)
  blocking?: BlockingDto;

  // Art. 11 d: an objection under art. 8 a must be briefly grounded, and a
  // blocking request "deberá ser fundada". Optional for the other types.
  @ValidateIf(
    (o: CreateRightsRequestDto) =>
      o.type === 'OBJECTION' ||
      o.type === 'BLOCKING' ||
      o.statement !== undefined,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  statement?: string;
}

/** O16 — POST /data-rights/requests/:id/complete (a public-form request, now with step-up). */
export class CompleteRightsRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  stepUpToken?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RectificationDto)
  rectification?: RectificationDto;

  @IsOptional()
  @Equals(true, { message: 'Erasure must be explicitly confirmed' })
  confirmErasure?: boolean;
}

/**
 * O16 — POST /data-rights/public-requests, no session (art. 11: "un
 * formulario de contacto o un medio electrónico equivalente"). Asks for
 * the minimum art. 11 lists: who (the address), what, and the grounds where
 * the law asks for them — never an ID number or a document.
 */
export class PublicRightsRequestDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsIn(PUBLIC_FORM_TYPES)
  type!: (typeof PUBLIC_FORM_TYPES)[number];

  @ValidateIf((o: PublicRightsRequestDto) => o.type === 'OBJECTION')
  @IsIn(OBJECTION_PURPOSE_CODES)
  purpose?: (typeof OBJECTION_PURPOSE_CODES)[number];

  @ValidateIf(
    (o: PublicRightsRequestDto) =>
      o.type === 'OBJECTION' || o.statement !== undefined,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  statement?: string;

  // Art. 11: with a rectification, erasure or objection the holder may ask
  // for the processing to be blocked while it's resolved.
  @IsOptional()
  @IsBoolean()
  requestBlocking?: boolean;
}

export class ConfirmPublicRequestDto {
  @IsString()
  @MinLength(20)
  @MaxLength(100)
  code!: string;
}

export class ListRequestsQueryDto {
  @IsOptional()
  @IsIn([
    'AWAITING_CONFIRMATION',
    'PENDING_STEP_UP',
    'RECEIVED',
    'VERIFIED',
    'IN_EVALUATION',
    'CLOSED',
  ])
  status?:
    | 'AWAITING_CONFIRMATION'
    | 'PENDING_STEP_UP'
    | 'RECEIVED'
    | 'VERIFIED'
    | 'IN_EVALUATION'
    | 'CLOSED';
}
