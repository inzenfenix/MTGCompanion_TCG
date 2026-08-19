import { IsString, MinLength } from 'class-validator';

export class RenameDeckDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
