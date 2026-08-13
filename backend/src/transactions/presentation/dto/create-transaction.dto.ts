import { IsUUID } from 'class-validator';

export class CreateTransactionDto {
  @IsUUID()
  cardId!: string;

  // Stand-in until auth/JWT lands — same gap as CreateCardDto.ownerId.
  // sellerId is deliberately NOT accepted here: it's derived from the
  // card's current owner inside TransactionsService.
  @IsUUID()
  buyerId!: string;
}
