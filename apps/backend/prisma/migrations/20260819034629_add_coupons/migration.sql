-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "issuedToUserId" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,
    "maxDiscount" DECIMAL(10,2) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "redeemedInTransactionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_redeemedInTransactionId_key" ON "coupons"("redeemedInTransactionId");

-- CreateIndex
CREATE INDEX "coupons_issuedToUserId_idx" ON "coupons"("issuedToUserId");

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_issuedToUserId_fkey" FOREIGN KEY ("issuedToUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_redeemedInTransactionId_fkey" FOREIGN KEY ("redeemedInTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
