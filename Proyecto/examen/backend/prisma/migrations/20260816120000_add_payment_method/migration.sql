-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('MERCADOPAGO', 'CASH');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "paymentMethod" "payment_method" NOT NULL DEFAULT 'MERCADOPAGO';

-- CreateIndex
CREATE UNIQUE INDEX "transactions_paymentRef_key" ON "transactions"("paymentRef");
