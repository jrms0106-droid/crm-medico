-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "billing";

-- CreateEnum
CREATE TYPE "billing"."PaymentMethod" AS ENUM ('cash', 'pix', 'debit_card', 'credit_card', 'other');

-- CreateTable
CREATE TABLE "billing"."price_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."charges" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "appointment_id" UUID,
    "price_item_id" UUID,
    "description" VARCHAR(200) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" VARCHAR(200),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."payments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "charge_id" UUID NOT NULL,
    "method" "billing"."PaymentMethod" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "received_by_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "reverse_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_items_organization_id_name_key" ON "billing"."price_items"("organization_id", "name");

-- CreateIndex
CREATE INDEX "charges_organization_id_unit_id_created_at_idx" ON "billing"."charges"("organization_id", "unit_id", "created_at");

-- CreateIndex
CREATE INDEX "charges_patient_id_idx" ON "billing"."charges"("patient_id");

-- CreateIndex
CREATE INDEX "payments_charge_id_idx" ON "billing"."payments"("charge_id");

-- CreateIndex
CREATE INDEX "payments_organization_id_paid_at_idx" ON "billing"."payments"("organization_id", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_idempotency_key_key" ON "billing"."payments"("organization_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "billing"."charges" ADD CONSTRAINT "charges_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."charges" ADD CONSTRAINT "charges_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "scheduling"."appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."charges" ADD CONSTRAINT "charges_price_item_id_fkey" FOREIGN KEY ("price_item_id") REFERENCES "billing"."price_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."payments" ADD CONSTRAINT "payments_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "billing"."charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o Prisma não expressa (docs/api/financeiro.md)

ALTER TABLE "billing"."price_items"
  ADD CONSTRAINT "price_items_amount_range" CHECK ("amount_cents" BETWEEN 1 AND 10000000);

ALTER TABLE "billing"."charges"
  ADD CONSTRAINT "charges_amount_range" CHECK ("amount_cents" BETWEEN 1 AND 10000000),
  ADD CONSTRAINT "charges_discount_range" CHECK ("discount_cents" BETWEEN 0 AND "amount_cents"),
  ADD CONSTRAINT "charges_cancel_coherent" CHECK (
    ("cancelled_at" IS NULL) = ("cancel_reason" IS NULL)
    AND ("cancelled_at" IS NULL) = ("cancelled_by_id" IS NULL)
  );

ALTER TABLE "billing"."payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_cents" >= 1),
  ADD CONSTRAINT "payments_reverse_coherent" CHECK (
    ("reversed_at" IS NULL) = ("reverse_reason" IS NULL)
    AND ("reversed_at" IS NULL) = ("reversed_by_id" IS NULL)
  );

-- Uma consulta tem no máximo uma cobrança não cancelada.
CREATE UNIQUE INDEX "charges_one_active_per_appointment"
  ON "billing"."charges" ("appointment_id")
  WHERE "appointment_id" IS NOT NULL AND "cancelled_at" IS NULL;

-- Cobrança: valor, desconto, paciente e origem não mudam; o cancelamento não volta atrás.
CREATE FUNCTION "billing"."protect_charge"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Cobrança não pode ser apagada.';
  END IF;
  IF NEW."amount_cents" <> OLD."amount_cents"
     OR NEW."discount_cents" <> OLD."discount_cents"
     OR NEW."patient_id" <> OLD."patient_id"
     OR NEW."unit_id" <> OLD."unit_id"
     OR NEW."organization_id" <> OLD."organization_id"
     OR NEW."appointment_id" IS DISTINCT FROM OLD."appointment_id"
     OR NEW."price_item_id" IS DISTINCT FROM OLD."price_item_id"
     OR NEW."description" <> OLD."description"
     OR NEW."created_by_user_id" <> OLD."created_by_user_id" THEN
    RAISE EXCEPTION 'Valor e dados da cobrança não podem ser alterados.';
  END IF;
  IF OLD."cancelled_at" IS NOT NULL AND (
       NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
       OR NEW."cancel_reason" IS DISTINCT FROM OLD."cancel_reason"
       OR NEW."cancelled_by_id" IS DISTINCT FROM OLD."cancelled_by_id") THEN
    RAISE EXCEPTION 'Cobrança cancelada não pode ser alterada.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "charges_protected"
  BEFORE UPDATE OR DELETE ON "billing"."charges"
  FOR EACH ROW EXECUTE FUNCTION "billing"."protect_charge"();

-- Pagamento: só o estorno, uma vez, pode ser gravado depois.
CREATE FUNCTION "billing"."protect_payment"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pagamento não pode ser apagado.';
  END IF;
  IF NEW."amount_cents" <> OLD."amount_cents"
     OR NEW."method" <> OLD."method"
     OR NEW."paid_at" <> OLD."paid_at"
     OR NEW."charge_id" <> OLD."charge_id"
     OR NEW."organization_id" <> OLD."organization_id"
     OR NEW."received_by_user_id" <> OLD."received_by_user_id"
     OR NEW."idempotency_key" <> OLD."idempotency_key"
     OR NEW."request_hash" <> OLD."request_hash"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'Pagamento não pode ser alterado; use o estorno.';
  END IF;
  IF OLD."reversed_at" IS NOT NULL AND (
       NEW."reversed_at" IS DISTINCT FROM OLD."reversed_at"
       OR NEW."reverse_reason" IS DISTINCT FROM OLD."reverse_reason"
       OR NEW."reversed_by_id" IS DISTINCT FROM OLD."reversed_by_id") THEN
    RAISE EXCEPTION 'Pagamento estornado não pode ser alterado.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "payments_protected"
  BEFORE UPDATE OR DELETE ON "billing"."payments"
  FOR EACH ROW EXECUTE FUNCTION "billing"."protect_payment"();
