-- Necessária para combinar igualdade de uuid com sobreposição de intervalos no EXCLUDE.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "scheduling";

-- CreateEnum
CREATE TYPE "scheduling"."AppointmentKind" AS ENUM ('regular', 'return', 'fit_in');

-- CreateEnum
CREATE TYPE "scheduling"."AppointmentStatus" AS ENUM ('scheduled', 'confirmed', 'arrived', 'cancelled', 'no_show', 'rescheduled');

-- CreateEnum
CREATE TYPE "scheduling"."WaitlistStatus" AS ENUM ('waiting', 'scheduled', 'removed');

-- CreateTable
CREATE TABLE "scheduling"."schedules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "slot_minutes" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."schedule_rules" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,

    CONSTRAINT "schedule_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."schedule_blocks" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),
    "removed_by_user_id" UUID,

    CONSTRAINT "schedule_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."appointments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "kind" "scheduling"."AppointmentKind" NOT NULL DEFAULT 'regular',
    "status" "scheduling"."AppointmentStatus" NOT NULL DEFAULT 'scheduled',
    "notes" VARCHAR(200),
    "return_of_id" UUID,
    "rescheduled_from_id" UUID,
    "rescheduled_to_id" UUID,
    "cancel_reason" VARCHAR(200),
    "cancel_requested_by" VARCHAR(20),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."appointment_events" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "appointment_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "by_user_id" UUID NOT NULL,
    "details" JSONB,

    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduling"."waitlist_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "professional_id" UUID,
    "preference" VARCHAR(200),
    "status" "scheduling"."WaitlistStatus" NOT NULL DEFAULT 'waiting',
    "appointment_id" UUID,
    "removed_reason" VARCHAR(200),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "schedules_organization_id_idx" ON "scheduling"."schedules"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_unit_id_professional_id_key" ON "scheduling"."schedules"("unit_id", "professional_id");

-- CreateIndex
CREATE INDEX "schedule_rules_schedule_id_weekday_idx" ON "scheduling"."schedule_rules"("schedule_id", "weekday");

-- CreateIndex
CREATE INDEX "schedule_blocks_schedule_id_starts_at_idx" ON "scheduling"."schedule_blocks"("schedule_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_rescheduled_from_id_key" ON "scheduling"."appointments"("rescheduled_from_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_rescheduled_to_id_key" ON "scheduling"."appointments"("rescheduled_to_id");

-- CreateIndex
CREATE INDEX "appointments_schedule_id_starts_at_idx" ON "scheduling"."appointments"("schedule_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_patient_id_starts_at_idx" ON "scheduling"."appointments"("patient_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_events_seq_key" ON "scheduling"."appointment_events"("seq");

-- CreateIndex
CREATE INDEX "appointment_events_appointment_id_idx" ON "scheduling"."appointment_events"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entries_appointment_id_key" ON "scheduling"."waitlist_entries"("appointment_id");

-- CreateIndex
CREATE INDEX "waitlist_entries_unit_id_status_created_at_idx" ON "scheduling"."waitlist_entries"("unit_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "scheduling"."schedules" ADD CONSTRAINT "schedules_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org"."units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."schedules" ADD CONSTRAINT "schedules_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "org"."professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."schedule_rules" ADD CONSTRAINT "schedule_rules_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "scheduling"."schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."schedule_blocks" ADD CONSTRAINT "schedule_blocks_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "scheduling"."schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."appointments" ADD CONSTRAINT "appointments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "scheduling"."schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "scheduling"."appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."waitlist_entries" ADD CONSTRAINT "waitlist_entries_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org"."units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."waitlist_entries" ADD CONSTRAINT "waitlist_entries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduling"."waitlist_entries" ADD CONSTRAINT "waitlist_entries_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "org"."professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restrições que o Prisma não expressa no esquema.
ALTER TABLE "scheduling"."schedules"
  ADD CONSTRAINT "schedules_slot_minutes_range" CHECK ("slot_minutes" BETWEEN 5 AND 240 AND "slot_minutes" % 5 = 0);

ALTER TABLE "scheduling"."schedule_rules"
  ADD CONSTRAINT "schedule_rules_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6),
  ADD CONSTRAINT "schedule_rules_minutes_range" CHECK ("start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute");

ALTER TABLE "scheduling"."schedule_blocks"
  ADD CONSTRAINT "schedule_blocks_period" CHECK ("ends_at" > "starts_at");

ALTER TABLE "scheduling"."appointments"
  ADD CONSTRAINT "appointments_duration" CHECK ("ends_at" > "starts_at" AND "ends_at" - "starts_at" <= interval '240 minutes'),
  ADD CONSTRAINT "appointments_cancel_requested_by" CHECK ("cancel_requested_by" IS NULL OR "cancel_requested_by" IN ('patient', 'clinic')),
  -- Duas consultas ativas (que não sejam encaixe) nunca se sobrepõem na mesma agenda.
  ADD CONSTRAINT "appointments_no_overlap" EXCLUDE USING gist (
    "schedule_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("status" IN ('scheduled', 'confirmed', 'arrived') AND "kind" <> 'fit_in');

-- Histórico das consultas: somente-acréscimo.
CREATE FUNCTION "scheduling"."reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%.% aceita apenas inclusão (% recusado)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "appointment_events_append_only"
  BEFORE UPDATE OR DELETE ON "scheduling"."appointment_events"
  FOR EACH ROW EXECUTE FUNCTION "scheduling"."reject_change"();
