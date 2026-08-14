import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class ConfirmPhotoDto {
  @IsString()
  @MinLength(1)
  storageKey!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
