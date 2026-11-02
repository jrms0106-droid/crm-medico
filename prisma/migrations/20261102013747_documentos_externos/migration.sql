-- CreateEnum
CREATE TYPE "documents"."ExternalDocumentKind" AS ENUM ('prescription', 'controlled_prescription', 'antimicrobial_prescription', 'certificate', 'exam_request', 'other');

-- CreateEnum
CREATE TYPE "documents"."ExternalDocumentStatus" AS ENUM ('registered', 'cancelled');

-- CreateTable
CREATE TABLE "documents"."external_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "encounter_id" UUID,
    "unit_id" UUID,
    "platform" VARCHAR(20) NOT NULL DEFAULT 'cfm',
    "kind" "documents"."ExternalDocumentKind" NOT NULL,
    "status" "documents"."ExternalDocumentStatus" NOT NULL DEFAULT 'registered',
    "issued_on" DATE NOT NULL,
    "summary" VARCHAR(2000) NOT NULL,
    "validation_code" VARCHAR(100),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" UUID,
    "cancel_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_documents_patient_id_issued_on_idx" ON "documents"."external_documents"("patient_id", "issued_on");

-- CreateIndex
CREATE INDEX "external_documents_author_user_id_idx" ON "documents"."external_documents"("author_user_id");

-- AddForeignKey
ALTER TABLE "documents"."external_documents" ADD CONSTRAINT "external_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents"."external_documents" ADD CONSTRAINT "external_documents_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "care"."encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o Prisma não expressa (docs/api/documentos-externos.md).
ALTER TABLE "documents"."external_documents"
  ADD CONSTRAINT "external_documents_platform_known" CHECK ("platform" IN ('cfm')),
  ADD CONSTRAINT "external_documents_summary_length" CHECK (char_length(btrim("summary")) >= 3),
  ADD CONSTRAINT "external_documents_cancel_coherent" CHECK (
    ("status" = 'registered' AND "cancelled_at" IS NULL AND "cancelled_by_user_id" IS NULL AND "cancel_reason" IS NULL)
    OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL AND "cancelled_by_user_id" IS NOT NULL
        AND char_length(btrim("cancel_reason")) >= 10)
  );

-- Nada é apagado; a única mudança aceita é registered -> cancelled, sem tocar no resto.
CREATE FUNCTION "documents"."protect_external_document"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Registro de documento externo não pode ser apagado.';
  END IF;
  IF OLD."status" <> 'registered' OR NEW."status" <> 'cancelled'
     OR NEW."organization_id" <> OLD."organization_id"
     OR NEW."patient_id" <> OLD."patient_id"
     OR NEW."author_user_id" <> OLD."author_user_id"
     OR NEW."encounter_id" IS DISTINCT FROM OLD."encounter_id"
     OR NEW."unit_id" IS DISTINCT FROM OLD."unit_id"
     OR NEW."platform" <> OLD."platform"
     OR NEW."kind" <> OLD."kind"
     OR NEW."issued_on" <> OLD."issued_on"
     OR NEW."summary" <> OLD."summary"
     OR NEW."validation_code" IS DISTINCT FROM OLD."validation_code"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'Registro de documento externo só pode ser cancelado.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "external_documents_protected"
  BEFORE UPDATE OR DELETE ON "documents"."external_documents"
  FOR EACH ROW EXECUTE FUNCTION "documents"."protect_external_document"();
