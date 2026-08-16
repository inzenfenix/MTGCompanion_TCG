-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "lastLat" DOUBLE PRECISION,
ADD COLUMN     "lastLng" DOUBLE PRECISION,
ADD COLUMN     "locationUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "shareLocation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "catalog_cards" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "setCode" TEXT NOT NULL,
    "setName" TEXT NOT NULL,
    "rarity" TEXT,
    "typeLine" TEXT,
    "manaCost" TEXT,
    "cmc" DOUBLE PRECISION,
    "colors" TEXT[],
    "oracleText" TEXT,
    "imageUrl" TEXT,
    "edhrecRank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_cards_name_idx" ON "catalog_cards"("name");
