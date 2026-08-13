import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateTransactionData,
  TransactionRepository,
} from '../domain/transaction.repository';
import type { TransactionEntity } from '../domain/transaction.entity';
import type { Transaction, TransactionStatus } from '../../../generated/prisma';

@Injectable()
export class PrismaTransactionRepository implements TransactionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateTransactionData): Promise<TransactionEntity> {
    const tx = await this.prisma.transaction.create({
      data: {
        amount: data.amount,
        card: { connect: { id: data.cardId } },
        buyer: { connect: { id: data.buyerId } },
        seller: { connect: { id: data.sellerId } },
      },
    });
    return this.toEntity(tx);
  }

  async findById(id: string): Promise<TransactionEntity | null> {
    const tx = await this.prisma.transaction.findUnique({ where: { id } });
    return tx ? this.toEntity(tx) : null;
  }

  async findForUser(userId: string): Promise<TransactionEntity[]> {
    const txs = await this.prisma.transaction.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: { createdAt: 'desc' },
    });
    return txs.map((tx) => this.toEntity(tx));
  }

  async attachPayment(
    id: string,
    paymentProvider: string,
    paymentRef: string,
  ): Promise<TransactionEntity> {
    const tx = await this.prisma.transaction.update({
      where: { id },
      data: { paymentProvider, paymentRef },
    });
    return this.toEntity(tx);
  }

  async updateStatus(
    id: string,
    status: TransactionStatus,
  ): Promise<TransactionEntity> {
    const tx = await this.prisma.transaction.update({
      where: { id },
      data: { status },
    });
    return this.toEntity(tx);
  }

  private toEntity(tx: Transaction): TransactionEntity {
    return { ...tx, amount: Number(tx.amount) };
  }
}
