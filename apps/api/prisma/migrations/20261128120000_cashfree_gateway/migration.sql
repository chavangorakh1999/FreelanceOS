-- CreateEnum
CREATE TYPE "GatewayEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "GatewayOrderStatus" AS ENUM ('ACTIVE', 'PAID', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "payment_gateways" (
    "workspaceId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'CASHFREE',
    "environment" "GatewayEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "clientId" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "secretLast4" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payment_gateways_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "gateway_orders" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'CASHFREE',
    "environment" "GatewayEnvironment" NOT NULL,
    "orderId" TEXT NOT NULL,
    "cfOrderId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "GatewayOrderStatus" NOT NULL DEFAULT 'ACTIVE',
    "gatewayPaymentId" TEXT,
    "paymentId" UUID,
    "portalUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "gateway_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_orders_orderId_key" ON "gateway_orders"("orderId");

-- CreateIndex
CREATE INDEX "gateway_orders_workspaceId_invoiceId_idx" ON "gateway_orders"("workspaceId", "invoiceId");

-- AddForeignKey
ALTER TABLE "gateway_orders" ADD CONSTRAINT "gateway_orders_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "gateway_orders" ADD CONSTRAINT "gateway_orders_amount_positive" CHECK ("amountMinor" > 0);
-- A gateway payment produces at most one recorded payment.
CREATE UNIQUE INDEX "gateway_orders_one_payment" ON "gateway_orders"("provider", "gatewayPaymentId") WHERE "gatewayPaymentId" IS NOT NULL;
