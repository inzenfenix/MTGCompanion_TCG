import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { CardCondition } from '../../../../generated/prisma';

// Hand-rolled instead of `PartialType(OmitType(CreateCardDto, ...))` from
// @nestjs/mapped-types — kept dependency-free rather than adding a package
// for four `@IsOptional()` fields. ownerId is deliberately excluded:
// transferring a card happens via a Transaction (see TransactionsModule),
// not a raw PATCH.
export class UpdateCardDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  guessedPrice?: number;

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
