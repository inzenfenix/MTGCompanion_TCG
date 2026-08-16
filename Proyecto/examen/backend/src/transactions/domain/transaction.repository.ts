import type {
  PaymentMethod,
  TransactionStatus,
} from '../../../generated/prisma';
import type { TransactionEntity } from './transaction.entity';

export interface CreateTransactionData {
  cardId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  paymentMethod: PaymentMethod;
}

export interface TransactionRepository {
  create(data: CreateTransactionData): Promise<TransactionEntity>;
  findById(id: string): Promise<TransactionEntity | null>;
  /** Transactions where the user is either the buyer or the seller. */
  findForUser(userId: string): Promise<TransactionEntity[]>;
  attachPayment(
    id: string,
    paymentProvider: string,
    paymentRef: string,
  ): Promise<TransactionEntity>;
  updateStatus(
    id: string,
    status: TransactionStatus,
  ): Promise<TransactionEntity>;
}

export const TRANSACTION_REPOSITORY = Symbol('TRANSACTION_REPOSITORY');
