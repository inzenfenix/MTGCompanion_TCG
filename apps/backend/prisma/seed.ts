/**
 * Local dev seed — NOT for production. Creates:
 *  - one known-credentials test account plus a "counterparty" account, some
 *    realistic-looking MTG cards (a few deliberately left without a photo,
 *    so the Ionic "add photo" edit flow has something real to test
 *    against), and a sample transaction between them;
 *  - 5 more plain test accounts (same password), each owning a couple of
 *    Vault cards, so the Trade tab has more than one real seller to browse
 *    against;
 *  - one easter-egg account (myr2003@monachina.com) whose Vault is full of
 *    real MTG card names/prices but every photo is actually anime fan art —
 *    see prisma/seed-assets/anime-easter-egg/SOURCES.md for image credits.
 *
 * Idempotent-ish: upserts the users by email, but re-running will add
 * duplicate cards/transactions each time (this is throwaway dev data, not
 * something that needs migration-grade idempotency — `prisma migrate reset`
 * wipes and reseeds if you want a clean slate). Photo uploads to MinIO are
 * NOT idempotent either (each run PUTs new objects under fresh UUID keys) —
 * harmless for local dev, just means old objects pile up in the bucket
 * across repeated `db:seed` runs.
 *
 * Run: npm run db:seed (or `npx prisma db seed`, same thing)
 */
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, CardCondition } from '../generated/prisma';

const SALT_ROUNDS = 12;
const SEED_PASSWORD = 'password123';

// Same STORAGE_* env vars src/storage/storage.service.ts uses — this script
// runs standalone (no Nest DI), so it talks to the S3/MinIO API directly
// rather than going through StorageService.
const storageBucket = process.env.STORAGE_BUCKET ?? 'mtg-card-photos';
const s3 = new S3Client({
  region: process.env.STORAGE_REGION ?? 'us-east-1',
  endpoint: process.env.STORAGE_ENDPOINT || undefined,
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === 'true',
  ...(process.env.STORAGE_ACCESS_KEY_ID
    ? {
        credentials: {
          accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
          secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
        },
      }
    : {}),
});

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/** Uploads a local seed asset to the bucket and returns the storageKey (not a URL — same convention as StorageService.buildKey). */
async function uploadSeedPhoto(cardId: string, localFilename: string): Promise<string> {
  const filePath = join(__dirname, 'seed-assets', 'anime-easter-egg', localFilename);
  const body = readFileSync(filePath);
  const ext = localFilename.slice(localFilename.lastIndexOf('.'));
  const key = `cards/${cardId}/${randomUUID()}${ext}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: storageBucket,
      Key: key,
      Body: body,
      ContentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
    }),
  );
  return key;
}

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

    console.log(`Seed users ready — log in with any of them, password "${SEED_PASSWORD}":`);
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

    // ── 5 more plain test accounts, each with a couple of Vault cards ──────
    // Gives the Trade tab more than one real seller to browse/filter/search
    // against, without the extra surface area of cross-account
    // transactions/offers (kept out on purpose — see the recommendation in
    // ROADMAP/CLAUDE.md conversation this was scoped from).
    const extraAccounts: {
      email: string;
      displayName: string;
      language: string;
      theme: string;
      cards: {
        title: string;
        description?: string;
        guessedPrice: number;
        condition: CardCondition;
        setName?: string;
        rarity?: string;
      }[];
    }[] = [
      {
        email: 'ana@example.com',
        displayName: 'Ana Torres',
        language: 'es-LA',
        theme: 'dark',
        cards: [
          { title: 'Wasteland', guessedPrice: 45, condition: CardCondition.NM, setName: 'Tempest', rarity: 'uncommon' },
          { title: 'Force of Will', guessedPrice: 90, condition: CardCondition.LP, setName: 'Alliances', rarity: 'uncommon' },
        ],
      },
      {
        email: 'carlos@example.com',
        displayName: 'Carlos Reyes',
        language: 'es-LA',
        theme: 'light',
        cards: [
          { title: 'Ancestral Recall', description: 'Sellada en funda dura, nunca jugada.', guessedPrice: 9500, condition: CardCondition.NM, setName: 'Alpha', rarity: 'rare' },
          { title: 'Underground Sea', guessedPrice: 850, condition: CardCondition.MP, setName: 'Revised', rarity: 'rare' },
          { title: 'Birds of Paradise', guessedPrice: 4.25, condition: CardCondition.NM },
        ],
      },
      {
        email: 'lucia@example.com',
        displayName: 'Lucía Fernández',
        language: 'en',
        theme: 'dark',
        cards: [
          { title: 'Jace, the Mind Sculptor', guessedPrice: 65, condition: CardCondition.LP, setName: 'Worldwake', rarity: 'mythic' },
          { title: 'Snapcaster Mage', guessedPrice: 22, condition: CardCondition.NM, setName: 'Innistrad', rarity: 'rare' },
        ],
      },
      {
        email: 'mateo@example.com',
        displayName: 'Mateo Silva',
        language: 'fr',
        theme: 'light',
        cards: [
          { title: 'Liliana of the Veil', guessedPrice: 48, condition: CardCondition.MP, setName: 'Innistrad', rarity: 'mythic' },
          { title: 'Fatal Push', guessedPrice: 8, condition: CardCondition.NM },
        ],
      },
      {
        email: 'valentina@example.com',
        displayName: 'Valentina Rojas',
        language: 'es-LA',
        theme: 'dark',
        cards: [
          { title: 'Ragavan, Nimble Pilferer', description: 'Comprada online, esquina inferior con marca leve.', guessedPrice: 55, condition: CardCondition.LP, setName: 'Modern Horizons 2', rarity: 'mythic' },
          { title: 'Solitude', guessedPrice: 30, condition: CardCondition.NM, setName: 'Modern Horizons 2', rarity: 'rare' },
          { title: 'Path to Exile', guessedPrice: 5.5, condition: CardCondition.HP },
        ],
      },
    ];

    for (const account of extraAccounts) {
      const user = await prisma.user.upsert({
        where: { email: account.email },
        update: {},
        create: {
          email: account.email,
          passwordHash,
          displayName: account.displayName,
          emailVerifiedAt: new Date(),
          settings: { create: { language: account.language, theme: account.theme } },
        },
      });
      const cardCount = await Promise.all(
        account.cards.map((card) =>
          prisma.card.create({ data: { ...card, owner: { connect: { id: user.id } } } }),
        ),
      );
      console.log(`Seed user ready: ${user.email} (${cardCount.length} cards, password "${SEED_PASSWORD}")`);
    }

    // ── Easter egg account ──────────────────────────────────────────────
    // Vault full of real, recognizable MTG cards (title/price/condition all
    // legit) — but every single photo is actually anime fan art instead of
    // the real card. See prisma/seed-assets/anime-easter-egg/SOURCES.md for
    // where the images came from and their licenses.
    const easterEgg = await prisma.user.upsert({
      where: { email: 'myr2003@monachina.com' },
      update: {},
      create: {
        email: 'myr2003@monachina.com',
        passwordHash,
        displayName: 'Myr',
        emailVerifiedAt: new Date(),
        settings: { create: { language: 'en', theme: 'dark' } },
      },
    });

    const easterEggCards: {
      title: string;
      guessedPrice: number;
      condition: CardCondition;
      setName?: string;
      rarity?: string;
      photoFile: string;
    }[] = [
      { title: 'Time Walk', guessedPrice: 7200, condition: CardCondition.LP, setName: 'Alpha', rarity: 'rare', photoFile: 'wikipe-tan.png' },
      { title: 'Mox Ruby', guessedPrice: 5800, condition: CardCondition.MP, setName: 'Unlimited', rarity: 'rare', photoFile: 'anime-girl-portrait.jpg' },
      { title: 'Bayou', guessedPrice: 320, condition: CardCondition.NM, setName: 'Revised', rarity: 'rare', photoFile: 'orange-hair-portrait.jpg' },
      { title: 'Sensei\'s Divining Top', guessedPrice: 60, condition: CardCondition.NM, setName: 'Champions of Kamigawa', rarity: 'rare', photoFile: 'moe-chieru-kio.png' },
      { title: 'Wrenn and Six', guessedPrice: 35, condition: CardCondition.LP, setName: 'Modern Horizons', rarity: 'rare', photoFile: 'animepedia-mascot.jpg' },
      { title: 'Karakas', guessedPrice: 40, condition: CardCondition.HP, setName: 'Legends', rarity: 'rare', photoFile: 'cute-girl.png' },
    ];

    for (const card of easterEggCards) {
      const { photoFile, ...cardData } = card;
      const created = await prisma.card.create({
        data: { ...cardData, owner: { connect: { id: easterEgg.id } } },
      });
      const storageKey = await uploadSeedPhoto(created.id, photoFile);
      await prisma.cardPhoto.create({
        data: { card: { connect: { id: created.id } }, storageKey, isPrimary: true },
      });
    }
    console.log(
      `Easter egg ready: ${easterEgg.email} (password "${SEED_PASSWORD}") — ${easterEggCards.length} "MTG cards" whose photos are all anime art 🎴`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
