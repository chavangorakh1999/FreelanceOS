-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'UPI', 'CARD', 'CASH', 'CHEQUE', 'OTHER');

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "projectId" UUID,
    "milestoneId" UUID,
    "changeRequestId" UUID,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "issueDate" DATE,
    "dueDate" DATE,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "supplierName" TEXT,
    "supplierTaxId" TEXT,
    "supplierAddress" TEXT,
    "billToName" TEXT,
    "billToTaxId" TEXT,
    "billToAddress" TEXT,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMPTZ,
    "issuedById" UUID,
    "voidedAt" TIMESTAMPTZ,
    "voidReason" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'INTERNAL',
    "sharedAt" TIMESTAMPTZ,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitLabel" TEXT NOT NULL DEFAULT 'unit',
    "unitRateMinor" BIGINT NOT NULL,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "taxBps" INTEGER NOT NULL DEFAULT 0,
    "netMinor" BIGINT NOT NULL,
    "taxMinor" BIGINT NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "receivedAt" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "note" TEXT,
    "idempotencyKey" TEXT,
    "reversedAt" TIMESTAMPTZ,
    "reversedById" UUID,
    "reversalReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "withholdingMinor" BIGINT NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedAt" DATE NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_workspaceId_clientId_status_idx" ON "invoices"("workspaceId", "clientId", "status");

-- CreateIndex
CREATE INDEX "invoices_workspaceId_status_dueDate_idx" ON "invoices"("workspaceId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_workspaceId_number_key" ON "invoices"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_position_idx" ON "invoice_lines"("invoiceId", "position");

-- CreateIndex
CREATE INDEX "payments_workspaceId_clientId_receivedAt_idx" ON "payments"("workspaceId", "clientId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_workspaceId_idempotencyKey_key" ON "payments"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_allocations_invoiceId_idx" ON "payment_allocations"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "credit_notes_invoiceId_idx" ON "credit_notes"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_workspaceId_number_key" ON "credit_notes"("workspaceId", "number");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Financial integrity (PRD §7.10, §9.14, App. B #9-12, #15, #18) ─────────────

-- An invoice is editable only as a DRAFT. Once issued, only void/visibility fields may change.
CREATE OR REPLACE FUNCTION invoices_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'invoice % is % and cannot be deleted; void it or issue a credit note', COALESCE(OLD."number", OLD."id"::text), OLD."status" USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'DRAFT' THEN
    IF NEW."status" NOT IN ('DRAFT', 'ISSUED') THEN
      RAISE EXCEPTION 'a draft invoice can only be issued, not %', NEW."status" USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" = 'ISSUED' AND (NEW."number" IS NULL OR NEW."issueDate" IS NULL OR NEW."dueDate" IS NULL) THEN
      RAISE EXCEPTION 'an issued invoice needs a number, an issue date and a due date' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'voidedAt' - 'voidReason' - 'visibility' - 'sharedAt' - 'updatedAt')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'voidedAt' - 'voidReason' - 'visibility' - 'sharedAt' - 'updatedAt') THEN
    RAISE EXCEPTION 'invoice % is issued and its content is immutable; issue a credit note or void and reissue', OLD."number" USING ERRCODE = 'restrict_violation';
  END IF;

  IF NOT (OLD."status" = NEW."status" OR (OLD."status" = 'ISSUED' AND NEW."status" = 'VOID')) THEN
    RAISE EXCEPTION 'illegal invoice transition % -> %', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" = 'ISSUED' AND NEW."status" = 'VOID' THEN
    IF EXISTS (SELECT 1 FROM "payment_allocations" a JOIN "payments" p ON p."id" = a."paymentId" WHERE a."invoiceId" = OLD."id" AND p."reversedAt" IS NULL)
       OR EXISTS (SELECT 1 FROM "credit_notes" c WHERE c."invoiceId" = OLD."id") THEN
      RAISE EXCEPTION 'invoice % has payments or credit notes and cannot be voided; issue a credit note instead', OLD."number" USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_guard_trg BEFORE UPDATE OR DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION invoices_guard();

CREATE OR REPLACE FUNCTION invoice_lines_guard() RETURNS trigger AS $$
DECLARE vid uuid; vstatus text;
BEGIN
  IF TG_OP = 'DELETE' THEN vid := OLD."invoiceId"; ELSE vid := NEW."invoiceId"; END IF;
  SELECT "status"::text INTO vstatus FROM "invoices" WHERE "id" = vid;
  IF vstatus IS NOT NULL AND vstatus <> 'DRAFT' THEN
    RAISE EXCEPTION '% on invoice_lines rejected: the invoice is % (immutable)', TG_OP, vstatus USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_lines_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();

-- A payment is never edited or deleted; only a one-way reversal is allowed.
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments cannot be deleted; reverse the payment instead' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."reversedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'this payment has already been reversed and is final' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'reversedAt' - 'reversedById' - 'reversalReason') IS DISTINCT FROM (to_jsonb(OLD) - 'reversedAt' - 'reversedById' - 'reversalReason') THEN
    RAISE EXCEPTION 'payments are immutable; reverse the payment and record it again' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."reversedAt" IS NOT NULL AND (NEW."reversalReason" IS NULL OR length(btrim(NEW."reversalReason")) < 3) THEN
    RAISE EXCEPTION 'a reversal needs a reason' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_guard_trg BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- Allocations are append-only and may not over-apply a payment or an invoice, even by a direct insert.
-- Locks are taken in a fixed order (payment, then invoice) so concurrent allocations serialise instead of deadlocking.
CREATE OR REPLACE FUNCTION payment_allocations_guard() RETURNS trigger AS $$
DECLARE pay "payments"%ROWTYPE; inv "invoices"%ROWTYPE; used bigint; done bigint; credited bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'payment_allocations is append-only (% blocked); reverse the payment instead', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT * INTO pay FROM "payments" WHERE "id" = NEW."paymentId" FOR UPDATE;
  SELECT * INTO inv FROM "invoices" WHERE "id" = NEW."invoiceId" FOR UPDATE;

  IF pay."reversedAt" IS NOT NULL THEN RAISE EXCEPTION 'cannot allocate a reversed payment' USING ERRCODE = 'restrict_violation'; END IF;
  IF inv."status" <> 'ISSUED' THEN RAISE EXCEPTION 'payments can only be allocated to issued invoices (this one is %)', inv."status" USING ERRCODE = 'restrict_violation'; END IF;
  IF inv."currency" <> pay."currency" THEN RAISE EXCEPTION 'currency mismatch: payment is %, invoice is %', pay."currency", inv."currency" USING ERRCODE = 'restrict_violation'; END IF;
  IF inv."clientId" <> pay."clientId" THEN RAISE EXCEPTION 'the payment and the invoice belong to different clients' USING ERRCODE = 'restrict_violation'; END IF;

  SELECT COALESCE(SUM("amountMinor"), 0) INTO used FROM "payment_allocations" WHERE "paymentId" = NEW."paymentId";
  IF used + NEW."amountMinor" > pay."amountMinor" THEN
    RAISE EXCEPTION 'allocations exceed the payment amount' USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT COALESCE(SUM(a."amountMinor" + a."withholdingMinor"), 0) INTO done
    FROM "payment_allocations" a JOIN "payments" p ON p."id" = a."paymentId"
   WHERE a."invoiceId" = NEW."invoiceId" AND p."reversedAt" IS NULL;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO credited FROM "credit_notes" WHERE "invoiceId" = NEW."invoiceId";
  IF done + credited + NEW."amountMinor" + NEW."withholdingMinor" > inv."totalMinor" THEN
    RAISE EXCEPTION 'allocation exceeds the outstanding balance of invoice %', inv."number" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocations_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION payment_allocations_guard();

-- Credit notes are append-only and cannot credit more than is still owed.
CREATE OR REPLACE FUNCTION credit_notes_guard() RETURNS trigger AS $$
DECLARE inv "invoices"%ROWTYPE; done bigint; credited bigint;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'credit_notes is append-only (% blocked)', TG_OP USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT * INTO inv FROM "invoices" WHERE "id" = NEW."invoiceId" FOR UPDATE;
  IF inv."status" <> 'ISSUED' THEN RAISE EXCEPTION 'only an issued invoice can be credited (this one is %)', inv."status" USING ERRCODE = 'restrict_violation'; END IF;
  IF inv."currency" <> NEW."currency" THEN RAISE EXCEPTION 'currency mismatch on credit note' USING ERRCODE = 'restrict_violation'; END IF;
  SELECT COALESCE(SUM(a."amountMinor" + a."withholdingMinor"), 0) INTO done
    FROM "payment_allocations" a JOIN "payments" p ON p."id" = a."paymentId"
   WHERE a."invoiceId" = NEW."invoiceId" AND p."reversedAt" IS NULL;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO credited FROM "credit_notes" WHERE "invoiceId" = NEW."invoiceId";
  IF done + credited + NEW."amountMinor" > inv."totalMinor" THEN
    RAISE EXCEPTION 'a credit note cannot exceed the outstanding balance of invoice %', inv."number" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_notes_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON "credit_notes" FOR EACH ROW EXECUTE FUNCTION credit_notes_guard();

-- Sanity constraints
ALTER TABLE "payments"            ADD CONSTRAINT "payments_positive"            CHECK ("amountMinor" > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_shape"    CHECK ("amountMinor" >= 0 AND "withholdingMinor" >= 0 AND "amountMinor" + "withholdingMinor" > 0);
ALTER TABLE "credit_notes"        ADD CONSTRAINT "credit_notes_positive"        CHECK ("amountMinor" > 0);
ALTER TABLE "invoices"            ADD CONSTRAINT "invoices_totals_non_negative" CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0);
ALTER TABLE "invoices"            ADD CONSTRAINT "invoices_due_after_issue"     CHECK ("dueDate" IS NULL OR "issueDate" IS NULL OR "dueDate" >= "issueDate");
ALTER TABLE "invoice_lines"       ADD CONSTRAINT "invoice_lines_rates"          CHECK ("unitRateMinor" >= 0 AND "quantity" >= 0 AND "discountBps" BETWEEN 0 AND 10000 AND "taxBps" BETWEEN 0 AND 10000);
