-- AlterTable
ALTER TABLE "catalog_cards" ADD COLUMN     "borderColor" TEXT,
ADD COLUMN     "colorIdentity" TEXT[],
ADD COLUMN     "finishes" TEXT[],
ADD COLUMN     "frame" TEXT,
ADD COLUMN     "frameEffects" TEXT[],
ADD COLUMN     "releasedAt" TEXT,
ADD COLUMN     "setType" TEXT;
