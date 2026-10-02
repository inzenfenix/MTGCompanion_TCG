import { IsString, MinLength } from 'class-validator';

export class CreateDeckDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
