import type {
  PaymentMethod,
  TransactionStatus,
} from '../../../generated/prisma';

export interface TransactionEntity {
  id: string;
  cardId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: TransactionStatus;
  paymentMethod: PaymentMethod;
  paymentProvider: string | null;
  paymentRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}
