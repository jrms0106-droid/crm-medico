-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "records";

-- CreateEnum
CREATE TYPE "records"."RecordKind" AS ENUM ('consultation', 'evolution', 'addendum');

-- CreateEnum
CREATE TYPE "records"."RecordStatus" AS ENUM ('draft', 'finalized', 'signed', 'rectified', 'archived', 'discarded');

-- CreateEnum
CREATE TYPE "records"."RecordSensitivity" AS ENUM ('normal', 'elevated', 'restricted');

-- CreateTable
CREATE TABLE "records"."clinical_records" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "encounter_id" UUID,
    "unit_id" UUID,
    "kind" "records"."RecordKind" NOT NULL DEFAULT 'consultation',
    "clinical_date" DATE NOT NULL,
    "sensitivity" "records"."RecordSensitivity" NOT NULL DEFAULT 'normal',
    "status" "records"."RecordStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "form_version" VARCHAR(40) NOT NULL DEFAULT 'generic-v1',
    "content" JSONB NOT NULL,
    "ever_finalized" BOOLEAN NOT NULL DEFAULT false,
    "content_hash" CHAR(64),
    "signed_at" TIMESTAMPTZ(3),
    "signature_evidence" JSONB,
    "rectifies_id" UUID,
    "rectified_by_id" UUID,
    "addendum_of_id" UUID,
    "justification" VARCHAR(1000),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clinical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "records"."record_versions" (
    "id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "saved_at" TIMESTAMPTZ(3) NOT NULL,
    "saved_by_user_id" UUID NOT NULL,

    CONSTRAINT "record_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "records"."record_events" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "record_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "by_user_id" UUID NOT NULL,
    "details" JSONB,

    CONSTRAINT "record_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "records"."access_justifications" (
    "id" UUID NOT NULL,
    "record_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "justification" VARCHAR(1000) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "access_justifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinical_records_rectified_by_id_key" ON "records"."clinical_records"("rectified_by_id");

-- CreateIndex
CREATE INDEX "clinical_records_patient_id_clinical_date_idx" ON "records"."clinical_records"("patient_id", "clinical_date");

-- CreateIndex
CREATE INDEX "clinical_records_author_user_id_idx" ON "records"."clinical_records"("author_user_id");

-- CreateIndex
CREATE INDEX "clinical_records_rectifies_id_idx" ON "records"."clinical_records"("rectifies_id");

-- CreateIndex
CREATE INDEX "clinical_records_addendum_of_id_idx" ON "records"."clinical_records"("addendum_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "record_versions_record_id_version_key" ON "records"."record_versions"("record_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "record_events_seq_key" ON "records"."record_events"("seq");

-- CreateIndex
CREATE INDEX "record_events_record_id_idx" ON "records"."record_events"("record_id");

-- CreateIndex
CREATE INDEX "access_justifications_record_id_idx" ON "records"."access_justifications"("record_id");

-- AddForeignKey
ALTER TABLE "records"."clinical_records" ADD CONSTRAINT "clinical_records_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records"."clinical_records" ADD CONSTRAINT "clinical_records_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "care"."encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records"."record_versions" ADD CONSTRAINT "record_versions_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "records"."clinical_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "records"."record_events" ADD CONSTRAINT "record_events_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "records"."clinical_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o Prisma não expressa (docs/api/prontuario.md)

ALTER TABLE "records"."clinical_records"
  ADD CONSTRAINT "clinical_records_signed_has_hash" CHECK (
    "status" NOT IN ('signed', 'rectified', 'archived')
    OR ("content_hash" IS NOT NULL AND "signed_at" IS NOT NULL AND "signature_evidence" IS NOT NULL)
  ),
  ADD CONSTRAINT "clinical_records_addendum_coherent" CHECK (
    ("kind" = 'addendum') = ("addendum_of_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "clinical_records_single_link" CHECK (
    "rectifies_id" IS NULL OR "addendum_of_id" IS NULL
  ),
  ADD CONSTRAINT "clinical_records_correction_justified" CHECK (
    ("rectifies_id" IS NULL AND "addendum_of_id" IS NULL) OR "justification" IS NOT NULL
  ),
  ADD CONSTRAINT "clinical_records_version_positive" CHECK ("version" >= 1);

-- No máximo uma retificação em andamento ou assinada por registro original.
CREATE UNIQUE INDEX "clinical_records_one_open_rectification"
  ON "records"."clinical_records" ("rectifies_id")
  WHERE "rectifies_id" IS NOT NULL AND "status" <> 'discarded';

-- Registro assinado: conteúdo congelado; só a mudança de estado para retificado ou arquivado.
-- Nenhum registro é apagado.
CREATE FUNCTION "records"."protect_record"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Registro clínico não pode ser apagado.';
  END IF;
  IF OLD."status" IN ('signed', 'rectified', 'archived', 'discarded') THEN
    IF NEW."content" IS DISTINCT FROM OLD."content"
       OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
       OR NEW."signature_evidence" IS DISTINCT FROM OLD."signature_evidence"
       OR NEW."signed_at" IS DISTINCT FROM OLD."signed_at"
       OR NEW."sensitivity" <> OLD."sensitivity"
       OR NEW."clinical_date" <> OLD."clinical_date"
       OR NEW."author_user_id" <> OLD."author_user_id"
       OR NEW."patient_id" <> OLD."patient_id"
       OR NEW."organization_id" <> OLD."organization_id"
       OR NEW."kind" <> OLD."kind"
       OR NEW."version" <> OLD."version"
       OR NEW."form_version" <> OLD."form_version"
       OR NEW."encounter_id" IS DISTINCT FROM OLD."encounter_id"
       OR NEW."rectifies_id" IS DISTINCT FROM OLD."rectifies_id"
       OR NEW."addendum_of_id" IS DISTINCT FROM OLD."addendum_of_id"
       OR NEW."justification" IS DISTINCT FROM OLD."justification" THEN
      RAISE EXCEPTION 'Registro assinado não pode ter o conteúdo alterado.';
    END IF;
    IF NOT (
      NEW."status" = OLD."status"
      OR (OLD."status" = 'signed' AND NEW."status" IN ('rectified', 'archived'))
      OR (OLD."status" = 'rectified' AND NEW."status" = 'archived')
    ) THEN
      RAISE EXCEPTION 'Mudança de estado não permitida para registro assinado.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "clinical_records_protected"
  BEFORE UPDATE OR DELETE ON "records"."clinical_records"
  FOR EACH ROW EXECUTE FUNCTION "records"."protect_record"();

CREATE FUNCTION "records"."reject_change"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabela somente-acréscimo: % não é permitido.', TG_OP;
END;
$$;

CREATE TRIGGER "record_versions_append_only"
  BEFORE UPDATE OR DELETE ON "records"."record_versions"
  FOR EACH ROW EXECUTE FUNCTION "records"."reject_change"();

CREATE TRIGGER "record_events_append_only"
  BEFORE UPDATE OR DELETE ON "records"."record_events"
  FOR EACH ROW EXECUTE FUNCTION "records"."reject_change"();

CREATE TRIGGER "access_justifications_append_only"
  BEFORE UPDATE OR DELETE ON "records"."access_justifications"
  FOR EACH ROW EXECUTE FUNCTION "records"."reject_change"();
