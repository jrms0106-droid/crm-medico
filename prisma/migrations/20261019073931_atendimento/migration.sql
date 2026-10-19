-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "care";

-- CreateEnum
CREATE TYPE "care"."EncounterStatus" AS ENUM ('started', 'closed');

-- CreateEnum
CREATE TYPE "care"."EmergencyReviewOutcome" AS ENUM ('appropriate', 'inappropriate');

-- CreateTable
CREATE TABLE "care"."encounters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_user_id" UUID NOT NULL,
    "status" "care"."EncounterStatus" NOT NULL DEFAULT 'started',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "follow_up_until" TIMESTAMPTZ(3),

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care"."emergency_accesses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "justification" VARCHAR(1000) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "review_outcome" "care"."EmergencyReviewOutcome",
    "review_notes" VARCHAR(1000),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" UUID,

    CONSTRAINT "emergency_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encounters_appointment_id_key" ON "care"."encounters"("appointment_id");

-- CreateIndex
CREATE INDEX "encounters_doctor_user_id_patient_id_idx" ON "care"."encounters"("doctor_user_id", "patient_id");

-- CreateIndex
CREATE INDEX "encounters_organization_id_idx" ON "care"."encounters"("organization_id");

-- CreateIndex
CREATE INDEX "emergency_accesses_user_id_patient_id_expires_at_idx" ON "care"."emergency_accesses"("user_id", "patient_id", "expires_at");

-- CreateIndex
CREATE INDEX "emergency_accesses_organization_id_reviewed_at_idx" ON "care"."emergency_accesses"("organization_id", "reviewed_at");

-- AddForeignKey
ALTER TABLE "care"."encounters" ADD CONSTRAINT "encounters_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "scheduling"."appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."encounters" ADD CONSTRAINT "encounters_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care"."emergency_accesses" ADD CONSTRAINT "emergency_accesses_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras que o Prisma não expressa (docs/api/atendimento-e-vinculo.md)

-- Encerramento coerente: aberto sem data de fim; encerrado com data de fim; acompanhamento só depois do fim.
ALTER TABLE "care"."encounters"
  ADD CONSTRAINT "encounters_closed_coherent" CHECK (
    ("status" = 'started' AND "closed_at" IS NULL AND "follow_up_until" IS NULL)
    OR ("status" = 'closed' AND "closed_at" IS NOT NULL AND "closed_at" >= "started_at"
        AND ("follow_up_until" IS NULL OR "follow_up_until" > "closed_at"))
  );

-- Um único atendimento aberto por médico e paciente.
ALTER TABLE "care"."encounters"
  ADD CONSTRAINT "encounters_one_open_per_doctor_patient"
  EXCLUDE USING btree ("doctor_user_id" WITH =, "patient_id" WITH =) WHERE ("status" = 'started');

ALTER TABLE "care"."emergency_accesses"
  ADD CONSTRAINT "emergency_accesses_period" CHECK ("expires_at" > "starts_at"),
  ADD CONSTRAINT "emergency_accesses_justification" CHECK (char_length("justification") >= 20),
  ADD CONSTRAINT "emergency_accesses_review_coherent" CHECK (
    ("reviewed_at" IS NULL AND "review_outcome" IS NULL AND "reviewed_by_user_id" IS NULL)
    OR ("reviewed_at" IS NOT NULL AND "review_outcome" IS NOT NULL AND "reviewed_by_user_id" IS NOT NULL)
  );

-- O acesso emergencial nunca é apagado, e a única alteração aceita é gravar a revisão, uma vez.
CREATE FUNCTION "care"."protect_emergency_access"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Acesso emergencial não pode ser apagado.';
  END IF;
  IF OLD."reviewed_at" IS NOT NULL THEN
    RAISE EXCEPTION 'Acesso emergencial já revisado não pode ser alterado.';
  END IF;
  IF NEW."organization_id" <> OLD."organization_id" OR NEW."patient_id" <> OLD."patient_id"
     OR NEW."user_id" <> OLD."user_id" OR NEW."justification" <> OLD."justification"
     OR NEW."starts_at" <> OLD."starts_at" OR NEW."expires_at" <> OLD."expires_at" THEN
    RAISE EXCEPTION 'Só a revisão do acesso emergencial pode ser gravada.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "emergency_accesses_protected"
  BEFORE UPDATE OR DELETE ON "care"."emergency_accesses"
  FOR EACH ROW EXECUTE FUNCTION "care"."protect_emergency_access"();
