import { IsString, Length } from 'class-validator';

/** Used by /auth/2fa/enable and /auth/2fa/disable — a current authenticator-app code. */
export class TwoFactorCodeDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}
