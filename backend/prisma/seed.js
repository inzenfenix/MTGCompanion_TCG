"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_pg_1 = require("@prisma/adapter-pg");
const bcrypt = __importStar(require("bcryptjs"));
const prisma_1 = require("../generated/prisma");
const SALT_ROUNDS = 12;
const SEED_PASSWORD = 'password123';
async function main() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set — copy .env.example to .env first');
    }
    const prisma = new prisma_1.PrismaClient({ adapter: new adapter_pg_1.PrismaPg({ connectionString }) });
    try {
        const passwordHash = await bcrypt.hash(SEED_PASSWORD, SALT_ROUNDS);
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
        const cards = [
            {
                title: 'Black Lotus',
                description: 'La joya de la colección. Esquina superior con desgaste leve.',
                guessedPrice: 45000,
                condition: prisma_1.CardCondition.LP,
                setName: 'Alpha',
                rarity: 'rare',
                oracleText: 'T, Sacrifice Black Lotus: Add three mana of any one color.',
            },
            {
                title: 'Lightning Bolt',
                guessedPrice: 3.5,
                condition: prisma_1.CardCondition.NM,
                setName: 'Beta',
                rarity: 'common',
                oracleText: 'Lightning Bolt deals 3 damage to any target.',
            },
            {
                title: 'Tarmogoyf',
                description: 'Comprada en un torneo local, sin funda desde el día uno.',
                guessedPrice: 28,
                condition: prisma_1.CardCondition.MP,
                setName: 'Future Sight',
                rarity: 'rare',
            },
            {
                title: 'Sol Ring',
                guessedPrice: 6.75,
                condition: prisma_1.CardCondition.NM,
            },
            {
                title: 'Mox Sapphire',
                description: 'Doblez visible en la esquina inferior derecha, colores intactos.',
                guessedPrice: 6200,
                condition: prisma_1.CardCondition.HP,
                setName: 'Unlimited',
                rarity: 'rare',
            },
            {
                title: 'Counterspell',
                guessedPrice: 1.2,
                condition: prisma_1.CardCondition.DMG,
            },
        ];
        const createdCards = await Promise.all(cards.map((card) => prisma.card.create({
            data: { ...card, owner: { connect: { id: seller.id } } },
        })));
        console.log(`Seed cards ready: ${createdCards.length} (none have a photo yet)`);
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
    }
    finally {
        await prisma.$disconnect();
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=seed.js.map