import { IsString, MinLength } from 'class-validator';

export class RequestUploadUrlDto {
  @IsString()
  @MinLength(1)
  filename!: string;

  @IsString()
  @MinLength(1)
  contentType!: string;
}
