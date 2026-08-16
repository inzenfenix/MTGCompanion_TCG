import { IsString, Length } from 'class-validator';

/** Step 2 of a 2FA login: the challenge token from POST /auth/login + a current TOTP code. */
export class TwoFactorVerifyDto {
  @IsString()
  twoFactorToken!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
