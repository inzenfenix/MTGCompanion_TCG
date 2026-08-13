import { IsUUID } from 'class-validator';

export class CreateTransactionDto {
  @IsUUID()
  cardId!: string;

  // buyerId is NOT here — comes from the JWT (@CurrentUser() in
  // TransactionsController), same reasoning as CreateCardDto.ownerId.
  // sellerId is deliberately never accepted either: it's derived from the
  // card's current owner inside TransactionsService.
}
