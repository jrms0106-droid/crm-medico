-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "privacy";

-- CreateEnum
CREATE TYPE "privacy"."SubjectRequestKind" AS ENUM ('access', 'access_report', 'correction', 'portability', 'deletion', 'sharing_info', 'other');

-- CreateEnum
CREATE TYPE "privacy"."SubjectRequestStatus" AS ENUM ('open', 'completed', 'denied');

-- CreateTable
CREATE TABLE "privacy"."subject_requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" "privacy"."SubjectRequestKind" NOT NULL,
    "details" VARCHAR(1000),
    "status" "privacy"."SubjectRequestStatus" NOT NULL DEFAULT 'open',
    "due_on" DATE NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution" VARCHAR(1000),

    CONSTRAINT "subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subject_requests_organization_id_status_due_on_idx" ON "privacy"."subject_requests"("organization_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "subject_requests_patient_id_idx" ON "privacy"."subject_requests"("patient_id");

-- CreateIndex
CREATE INDEX "events_patient_id_occurred_at_idx" ON "audit"."events"("patient_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "privacy"."subject_requests" ADD CONSTRAINT "subject_requests_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras dos pedidos do titular (docs/api/direitos-do-titular.md).

ALTER TABLE "privacy"."subject_requests"
  ADD CONSTRAINT "subject_requests_details_length"
    CHECK ("details" IS NULL OR char_length("details") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "subject_requests_resolution_coherent"
    CHECK (
      ("status" = 'open' AND "resolved_at" IS NULL AND "resolved_by_user_id" IS NULL
        AND "resolution" IS NULL)
      OR ("status" <> 'open' AND "resolved_at" IS NOT NULL AND "resolved_by_user_id" IS NOT NULL
        AND char_length("resolution") BETWEEN 3 AND 1000)
    );

-- Pedido: nada é apagado; os dados do pedido não mudam; a resposta é gravada uma vez.
CREATE FUNCTION "privacy"."protect_subject_request"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Pedido do titular não pode ser apagado.';
  END IF;
  IF NEW."organization_id" <> OLD."organization_id"
     OR NEW."patient_id" <> OLD."patient_id"
     OR NEW."kind" <> OLD."kind"
     OR NEW."details" IS DISTINCT FROM OLD."details"
     OR NEW."due_on" <> OLD."due_on"
     OR NEW."created_by_user_id" <> OLD."created_by_user_id"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'Dados do pedido do titular não podem ser alterados.';
  END IF;
  IF OLD."status" <> 'open' THEN
    RAISE EXCEPTION 'Pedido do titular já respondido não pode ser alterado.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "subject_requests_protected"
  BEFORE UPDATE OR DELETE ON "privacy"."subject_requests"
  FOR EACH ROW EXECUTE FUNCTION "privacy"."protect_subject_request"();
