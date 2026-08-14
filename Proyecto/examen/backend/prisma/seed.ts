/**
 * Local dev seed — NOT for production. Creates one known-credentials test
 * account plus a second "counterparty" account, some realistic-looking MTG
 * cards (a few deliberately left without a photo, so the Ionic "add photo"
 * edit flow has something real to test against), and a sample transaction
 * between them.
 *
 * Idempotent-ish: upserts the users by email, but re-running will add
 * duplicate cards/transactions each time (this is throwaway dev data, not
 * something that needs migration-grade idempotency — `prisma migrate reset`
 * wipes and reseeds if you want a clean slate).
 *
 * Run: npm run db:seed (or `npx prisma db seed`, same thing)
 */
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { PrismaClient, CardCondition } from '../generated/prisma';

const SALT_ROUNDS = 12;
const SEED_PASSWORD = 'password123';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env first');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const passwordHash = await bcrypt.hash(SEED_PASSWORD, SALT_ROUNDS);

    // The account you actually log in as while testing the Ionic app / Postman / curl.
    const seller = await prisma.user.upsert({
      where: { email: 'test@example.com' },
      update: {},
      create: {
        email: 'test@example.com',
        passwordHash,
        displayName: 'Test Collector',
        emailVerifiedAt: new Date(),
        settings: { create: { language: 'en', theme: 'dark' } },
      },
    });

    // A second account so buyer/seller transactions have two real distinct users.
    const buyer = await prisma.user.upsert({
      where: { email: 'buyer@example.com' },
      update: {},
      create: {
        email: 'buyer@example.com',
        passwordHash,
        displayName: 'Test Buyer',
        emailVerifiedAt: new Date(),
        settings: { create: { language: 'en', theme: 'light' } },
      },
    });

    console.log(`Seed users ready — log in with either, password "${SEED_PASSWORD}":`);
    console.log(`  ${seller.email} (owns the cards below)`);
    console.log(`  ${buyer.email} (buyer in the sample transaction)`);

    // Real MTG cards with plausible prices/conditions. Deliberately mixed:
    // some have oracleText/setName/rarity filled in (cards that would've
    // come from a real Scryfall-backed "scan" flow), some don't (cards
    // added by hand, a realistic state for testing the edit page). None
    // have a photo yet — that's the point: gives the new "add a photo"
    // edit flow real cards to attach one to.
    const cards: {
      title: string;
      description?: string;
      guessedPrice: number;
      condition: CardCondition;
      scryfallId?: string;
      setName?: string;
      rarity?: string;
      oracleText?: string;
    }[] = [
      {
        title: 'Black Lotus',
        description: 'La joya de la colección. Esquina superior con desgaste leve.',
        guessedPrice: 45000,
        condition: CardCondition.LP,
        setName: 'Alpha',
        rarity: 'rare',
        oracleText: 'T, Sacrifice Black Lotus: Add three mana of any one color.',
      },
      {
        title: 'Lightning Bolt',
        guessedPrice: 3.5,
        condition: CardCondition.NM,
        setName: 'Beta',
        rarity: 'common',
        oracleText: 'Lightning Bolt deals 3 damage to any target.',
      },
      {
        title: 'Tarmogoyf',
        description: 'Comprada en un torneo local, sin funda desde el día uno.',
        guessedPrice: 28,
        condition: CardCondition.MP,
        setName: 'Future Sight',
        rarity: 'rare',
      },
      {
        title: 'Sol Ring',
        guessedPrice: 6.75,
        condition: CardCondition.NM,
      },
      {
        title: 'Mox Sapphire',
        description: 'Doblez visible en la esquina inferior derecha, colores intactos.',
        guessedPrice: 6200,
        condition: CardCondition.HP,
        setName: 'Unlimited',
        rarity: 'rare',
      },
      {
        title: 'Counterspell',
        guessedPrice: 1.2,
        condition: CardCondition.DMG,
      },
    ];

    const createdCards = await Promise.all(
      cards.map((card) =>
        prisma.card.create({
          data: { ...card, owner: { connect: { id: seller.id } } },
        }),
      ),
    );
    console.log(`Seed cards ready: ${createdCards.length} (none have a photo yet)`);

    // One sample transaction (buyer -> seller) so Transactions endpoints/UI have real data too.
    const [cardForSale] = createdCards;
    await prisma.transaction.create({
      data: {
        card: { connect: { id: cardForSale.id } },
        buyer: { connect: { id: buyer.id } },
        seller: { connect: { id: seller.id } },
        amount: cardForSale.guessedPrice,
        status: 'PENDING',
        paymentProvider: 'NoopPaymentProvider',
        paymentRef: `noop_seed_${cardForSale.id.slice(0, 8)}`,
      },
    });
    console.log(`Sample transaction ready: ${buyer.email} -> ${seller.email} for "${cardForSale.title}"`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
