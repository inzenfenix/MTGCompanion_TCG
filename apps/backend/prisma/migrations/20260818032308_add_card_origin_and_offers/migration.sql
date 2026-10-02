-- CreateEnum
CREATE TYPE "card_origin" AS ENUM ('VAULT', 'SCAN_LISTING');

-- DropIndex
DROP INDEX "catalog_cards_name_trgm_idx";

-- DropIndex
DROP INDEX "catalog_cards_oracle_text_trgm_idx";

-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "closesAt" TIMESTAMP(3),
ADD COLUMN     "origin" "card_origin" NOT NULL DEFAULT 'VAULT',
ADD COLUMN     "wonOfferId" TEXT;

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offers_cardId_createdAt_idx" ON "offers"("cardId", "createdAt");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
