import { IsString, Matches } from 'class-validator';

export class GrantConsentDto {
  // The version of the text the app displayed — see ConsentService.grantFromApp.
  @IsString()
  @Matches(/^\d{1,4}$/)
  version!: string;
}
