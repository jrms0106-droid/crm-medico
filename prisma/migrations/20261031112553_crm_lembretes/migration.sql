-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "crm";

-- CreateEnum
CREATE TYPE "crm"."MessageKind" AS ENUM ('appointment_reminder');

-- CreateEnum
CREATE TYPE "crm"."MessageStatus" AS ENUM ('queued', 'sent', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "crm"."messages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "kind" "crm"."MessageKind" NOT NULL,
    "channel" "patients"."CommChannel" NOT NULL,
    "to_number" VARCHAR(11) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "status" "crm"."MessageStatus" NOT NULL DEFAULT 'queued',
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(3),
    "provider_ref" VARCHAR(100),
    "last_error" VARCHAR(300),
    "cancelled_by_user_id" UUID,
    "cancel_reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_status_scheduled_for_idx" ON "crm"."messages"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "messages_organization_id_unit_id_scheduled_for_idx" ON "crm"."messages"("organization_id", "unit_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "messages_patient_id_idx" ON "crm"."messages"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_appointment_id_kind_key" ON "crm"."messages"("appointment_id", "kind");

-- AddForeignKey
ALTER TABLE "crm"."messages" ADD CONSTRAINT "messages_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm"."messages" ADD CONSTRAINT "messages_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "scheduling"."appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras dos lembretes (docs/api/crm-e-lembretes.md).

ALTER TABLE "crm"."messages"
  ADD CONSTRAINT "messages_to_number_digits" CHECK ("to_number" ~ '^[0-9]{10,11}$'),
  ADD CONSTRAINT "messages_attempts_range" CHECK ("attempts" BETWEEN 0 AND 3),
  ADD CONSTRAINT "messages_sent_coherent" CHECK (
    ("status" = 'sent') = ("sent_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "messages_cancel_coherent" CHECK (
    ("status" = 'cancelled') = ("cancel_reason" IS NOT NULL)
  );

-- Mensagem: nada é apagado; destinatário e texto não mudam; enviada, falhada ou cancelada é final.
CREATE FUNCTION "crm"."protect_message"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Mensagem ao paciente não pode ser apagada.';
  END IF;
  IF NEW."organization_id" <> OLD."organization_id"
     OR NEW."unit_id" <> OLD."unit_id"
     OR NEW."patient_id" <> OLD."patient_id"
     OR NEW."appointment_id" <> OLD."appointment_id"
     OR NEW."kind" <> OLD."kind"
     OR NEW."channel" <> OLD."channel"
     OR NEW."to_number" <> OLD."to_number"
     OR NEW."body" <> OLD."body"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'Destinatário e texto da mensagem não podem ser alterados.';
  END IF;
  IF OLD."status" <> 'queued' THEN
    RAISE EXCEPTION 'Mensagem já finalizada não pode ser alterada.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "messages_protected"
  BEFORE UPDATE OR DELETE ON "crm"."messages"
  FOR EACH ROW EXECUTE FUNCTION "crm"."protect_message"();
