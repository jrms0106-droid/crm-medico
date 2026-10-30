-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "documents";

-- CreateEnum
CREATE TYPE "documents"."DocumentKind" AS ENUM ('prescription', 'certificate', 'exam_request', 'referral', 'report');

-- CreateEnum
CREATE TYPE "documents"."DocumentStatus" AS ENUM ('draft', 'signed', 'cancelled', 'discarded');

-- CreateTable
CREATE TABLE "documents"."medical_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "encounter_id" UUID,
    "unit_id" UUID,
    "kind" "documents"."DocumentKind" NOT NULL,
    "status" "documents"."DocumentStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "snapshot" JSONB,
    "issued_on" DATE,
    "content_hash" CHAR(64),
    "signed_at" TIMESTAMPTZ(3),
    "signature_evidence" JSONB,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "cancel_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "medical_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents"."document_events" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "document_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "by_user_id" UUID NOT NULL,
    "details" JSONB,

    CONSTRAINT "document_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medical_documents_patient_id_created_at_idx" ON "documents"."medical_documents"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "medical_documents_author_user_id_idx" ON "documents"."medical_documents"("author_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_events_seq_key" ON "documents"."document_events"("seq");

-- CreateIndex
CREATE INDEX "document_events_document_id_idx" ON "documents"."document_events"("document_id");

-- AddForeignKey
ALTER TABLE "documents"."medical_documents" ADD CONSTRAINT "medical_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents"."medical_documents" ADD CONSTRAINT "medical_documents_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "care"."encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents"."document_events" ADD CONSTRAINT "document_events_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"."medical_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o Prisma não expressa (docs/api/documentos.md)

ALTER TABLE "documents"."medical_documents"
  ADD CONSTRAINT "medical_documents_signed_has_hash" CHECK (
    "status" NOT IN ('signed', 'cancelled')
    OR ("content_hash" IS NOT NULL AND "signed_at" IS NOT NULL AND "signature_evidence" IS NOT NULL
        AND "snapshot" IS NOT NULL AND "issued_on" IS NOT NULL)
  ),
  ADD CONSTRAINT "medical_documents_cancel_coherent" CHECK (
    ("status" = 'cancelled') = ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL
                                AND "cancelled_by_user_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "medical_documents_version_positive" CHECK ("version" >= 1);

-- Documento assinado: congelado; só o cancelamento é aceito. Nenhum documento é apagado.
CREATE FUNCTION "documents"."protect_document"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Documento médico não pode ser apagado.';
  END IF;
  IF OLD."status" IN ('signed', 'cancelled', 'discarded') THEN
    IF NEW."content" IS DISTINCT FROM OLD."content"
       OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot"
       OR NEW."issued_on" IS DISTINCT FROM OLD."issued_on"
       OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
       OR NEW."signature_evidence" IS DISTINCT FROM OLD."signature_evidence"
       OR NEW."signed_at" IS DISTINCT FROM OLD."signed_at"
       OR NEW."author_user_id" <> OLD."author_user_id"
       OR NEW."patient_id" <> OLD."patient_id"
       OR NEW."organization_id" <> OLD."organization_id"
       OR NEW."encounter_id" IS DISTINCT FROM OLD."encounter_id"
       OR NEW."unit_id" IS DISTINCT FROM OLD."unit_id"
       OR NEW."kind" <> OLD."kind"
       OR NEW."version" <> OLD."version" THEN
      RAISE EXCEPTION 'Documento assinado não pode ser alterado.';
    END IF;
    IF OLD."status" IN ('cancelled', 'discarded') AND (
         NEW."status" <> OLD."status"
         OR NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at"
         OR NEW."cancelled_by_user_id" IS DISTINCT FROM OLD."cancelled_by_user_id"
         OR NEW."cancel_reason" IS DISTINCT FROM OLD."cancel_reason") THEN
      RAISE EXCEPTION 'Documento cancelado ou descartado não pode ser alterado.';
    END IF;
    IF OLD."status" = 'signed' AND NEW."status" NOT IN ('signed', 'cancelled') THEN
      RAISE EXCEPTION 'Mudança de estado não permitida para documento assinado.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "medical_documents_protected"
  BEFORE UPDATE OR DELETE ON "documents"."medical_documents"
  FOR EACH ROW EXECUTE FUNCTION "documents"."protect_document"();

CREATE FUNCTION "documents"."reject_change"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabela somente-acréscimo: % não é permitido.', TG_OP;
END;
$$;

CREATE TRIGGER "document_events_append_only"
  BEFORE UPDATE OR DELETE ON "documents"."document_events"
  FOR EACH ROW EXECUTE FUNCTION "documents"."reject_change"();
