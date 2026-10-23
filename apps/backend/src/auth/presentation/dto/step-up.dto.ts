import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** POST /auth/step-up (ROADMAP.md O15) — re-authentication, nothing else asked. */
export class StepUpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password!: string;

  // Only when the account has 2FA enabled.
  @IsOptional()
  @Matches(/^\d{6}$/)
  code?: string;
}
