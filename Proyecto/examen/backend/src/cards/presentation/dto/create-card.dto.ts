import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { CardCondition } from '../../../../generated/prisma';

export class CreateCardDto {
  // ownerId is NOT here — it comes from the JWT (@CurrentUser() in
  // CardsController), never from the request body. Accepting it here would
  // let anyone create a card "owned" by someone else.
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  guessedPrice!: number;

  @IsOptional()
  @IsEnum(CardCondition)
  condition?: CardCondition;

  @IsOptional()
  @IsString()
  scryfallId?: string;

  @IsOptional()
  @IsString()
  setName?: string;

  @IsOptional()
  @IsString()
  rarity?: string;

  @IsOptional()
  @IsString()
  oracleText?: string;
}
