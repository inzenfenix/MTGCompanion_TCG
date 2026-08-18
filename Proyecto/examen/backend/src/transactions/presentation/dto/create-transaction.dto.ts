import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { PaymentMethod } from '../../../../generated/prisma';

export class CreateTransactionDto {
  @IsUUID()
  cardId!: string;

  // buyerId is NOT here — comes from the JWT (@CurrentUser() in
  // TransactionsController), same reasoning as CreateCardDto.ownerId.
  // sellerId is deliberately never accepted either: it's derived from the
  // card's current owner inside TransactionsService.

  // Defaults to MERCADOPAGO in TransactionsService when omitted — preserves
  // today's existing checkout path. CASH ("Efectivo") stays PENDING until
  // the seller confirms receipt (ROADMAP.md J6) — see CashPaymentProvider
  // and TransactionsService.confirmCashReceived().
  @IsOptional()
  @IsIn(['MERCADOPAGO', 'CASH'])
  paymentMethod?: PaymentMethod;
}
