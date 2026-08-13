import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { CardCondition } from '../../../../generated/prisma';

export class CreateCardDto {
  // Until auth/JWT lands (see backend/README.md), the owner is passed
  // explicitly instead of read off a session. Replace with `@Req() user.id`
  // once that pass ships.
  @IsUUID()
  ownerId!: string;

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
