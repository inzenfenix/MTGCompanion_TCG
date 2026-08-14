import type { TransactionStatus } from '../../../generated/prisma';

export interface TransactionEntity {
  id: string;
  cardId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  status: TransactionStatus;
  paymentProvider: string | null;
  paymentRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}
