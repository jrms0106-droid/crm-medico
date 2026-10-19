-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateEnum
CREATE TYPE "audit"."AuditOutcome" AS ENUM ('allowed', 'denied', 'not_found');

-- CreateTable
CREATE TABLE "org"."unit_memberships" (
    "user_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_memberships_pkey" PRIMARY KEY ("user_id","unit_id")
);

-- CreateTable
CREATE TABLE "org"."specialties" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org"."professionals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "crm_number" VARCHAR(10) NOT NULL,
    "crm_state" CHAR(2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org"."professional_specialties" (
    "professional_id" UUID NOT NULL,
    "specialty_id" UUID NOT NULL,
    "rqe" VARCHAR(10),

    CONSTRAINT "professional_specialties_pkey" PRIMARY KEY ("professional_id","specialty_id")
);

-- CreateTable
CREATE TABLE "audit"."events" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "organization_id" UUID,
    "actor_user_id" UUID,
    "session_id" UUID,
    "request_id" VARCHAR(64),
    "ip" VARCHAR(64),
    "action" VARCHAR(32) NOT NULL,
    "resource_type" VARCHAR(64) NOT NULL,
    "resource_id" VARCHAR(64),
    "unit_id" UUID,
    "patient_id" UUID,
    "outcome" "audit"."AuditOutcome" NOT NULL,
    "reason" VARCHAR(100) NOT NULL,
    "emergency" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_memberships_unit_id_idx" ON "org"."unit_memberships"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "specialties_organization_id_name_key" ON "org"."specialties"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "professionals_user_id_key" ON "org"."professionals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "professionals_organization_id_crm_state_crm_number_key" ON "org"."professionals"("organization_id", "crm_state", "crm_number");

-- CreateIndex
CREATE INDEX "professional_specialties_specialty_id_idx" ON "org"."professional_specialties"("specialty_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_seq_key" ON "audit"."events"("seq");

-- CreateIndex
CREATE INDEX "events_organization_id_occurred_at_idx" ON "audit"."events"("organization_id", "occurred_at");

-- CreateIndex
CREATE INDEX "events_actor_user_id_occurred_at_idx" ON "audit"."events"("actor_user_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "org"."unit_memberships" ADD CONSTRAINT "unit_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org"."unit_memberships" ADD CONSTRAINT "unit_memberships_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org"."units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org"."specialties" ADD CONSTRAINT "specialties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "org"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org"."professionals" ADD CONSTRAINT "professionals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "org"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org"."professionals" ADD CONSTRAINT "professionals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org"."professional_specialties" ADD CONSTRAINT "professional_specialties_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "org"."professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org"."professional_specialties" ADD CONSTRAINT "professional_specialties_specialty_id_fkey" FOREIGN KEY ("specialty_id") REFERENCES "org"."specialties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restrições que o Prisma não expressa no esquema.
ALTER TABLE "org"."professionals"
  ADD CONSTRAINT "professionals_crm_number_digits" CHECK ("crm_number" ~ '^[0-9]{1,10}$'),
  ADD CONSTRAINT "professionals_crm_state_valid" CHECK ("crm_state" IN (
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
    'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'));

ALTER TABLE "org"."professional_specialties"
  ADD CONSTRAINT "professional_specialties_rqe_digits" CHECK ("rqe" IS NULL OR "rqe" ~ '^[0-9]{1,10}$');

-- Auditoria somente-acréscimo: nenhuma linha pode ser alterada ou apagada.
-- (TRUNCATE e a revogação de privilégios do papel da aplicação entram na Etapa 7.)
CREATE FUNCTION "audit"."reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.events aceita apenas inclusão (% recusado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "events_append_only"
  BEFORE UPDATE OR DELETE ON "audit"."events"
  FOR EACH ROW EXECUTE FUNCTION "audit"."reject_change"();
