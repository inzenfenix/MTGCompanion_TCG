import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  displayName!: string;

  // Matches src/i18n.ts locales in trading-app-ionic (en / es-LA / fr).
  @IsOptional()
  @IsIn(['en', 'es-LA', 'fr'])
  language?: string;
}
