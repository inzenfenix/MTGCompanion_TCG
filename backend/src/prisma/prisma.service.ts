import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma';

// Prisma 7 removed the bundled query-engine binary — PrismaClient now always
// needs an explicit driver adapter, even with the classic "prisma-client-js"
// generator (see the comment in prisma/schema.prisma for why we're on that
// generator instead of the new ESM-only "prisma-client" one).
//
// Read directly from process.env rather than ConfigService: this class
// extends PrismaClient, so the adapter has to be built and handed to
// super() before any DI-injected constructor param would be available.
function buildAdapter() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env and adjust it');
  }
  return new PrismaPg({ connectionString });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ adapter: buildAdapter() });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to Postgres');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
