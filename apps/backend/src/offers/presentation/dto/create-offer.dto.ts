import { IsNumber, Min } from 'class-validator';

export class CreateOfferDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;
}
