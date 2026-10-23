import {
  Equals,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NoContactInfo } from '../../../common/privacy/no-contact-info.validator';

// ROADMAP.md O14 (ACTIVIDAD_4.md §1): this is the whole list of what the
// app asks a new player for. ValidationPipe's forbidNonWhitelisted (main.ts)
// rejects any extra field with a 400, so nothing outside this DTO — a phone,
// a birth date, an address — can be stored through registration.
export class RegisterUserDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // 72 = bcrypt's input limit: anything past it would be silently ignored
  // by the hash, so refuse it rather than give a false sense of strength.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  // A public alias shown to the other side of a trade — not a legal name,
  // and not a place for contact details.
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  @NoContactInfo()
  displayName!: string;

  // Instead of a birth date: the player declares being 18+ (marketplace with
  // real payments). Only `true` is accepted; what gets stored is when it was
  // declared (User.adultConfirmedAt), not the person's age.
  @Equals(true, { message: 'You must confirm you are 18 or older' })
  adultConfirmed!: boolean;

  // Matches src/i18n.ts locales in trading-app-ionic (en / es-LA / fr).
  @IsOptional()
  @IsIn(['en', 'es-LA', 'fr'])
  language?: string;
}
