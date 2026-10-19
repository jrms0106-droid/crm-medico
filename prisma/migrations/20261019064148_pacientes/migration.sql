-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "patients";

-- CreateEnum
CREATE TYPE "patients"."CommChannel" AS ENUM ('whatsapp', 'sms', 'email', 'phone');

-- CreateEnum
CREATE TYPE "patients"."PatientContactKind" AS ENUM ('guardian', 'emergency');

-- CreateTable
CREATE TABLE "patients"."patients" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "social_name" VARCHAR(200),
    "name_search" VARCHAR(410) NOT NULL,
    "cpf_enc" VARCHAR(255),
    "cpf_hash" CHAR(64),
    "birth_date" DATE NOT NULL,
    "email" VARCHAR(254),
    "address_zip" CHAR(8),
    "address_street" VARCHAR(200),
    "address_number" VARCHAR(20),
    "address_complement" VARCHAR(100),
    "address_district" VARCHAR(100),
    "address_city" VARCHAR(100),
    "address_state" CHAR(2),
    "comm_channels" "patients"."CommChannel"[] DEFAULT ARRAY[]::"patients"."CommChannel"[],
    "appointment_reminders" BOOLEAN NOT NULL DEFAULT false,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients"."phones" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "number" VARCHAR(11) NOT NULL,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients"."contacts" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "kind" "patients"."PatientContactKind" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "relationship" VARCHAR(60) NOT NULL,
    "phone" VARCHAR(11),
    "email" VARCHAR(254),
    "position" INTEGER NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients"."versions" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "changed_fields" TEXT[],
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patients_organization_id_birth_date_idx" ON "patients"."patients"("organization_id", "birth_date");

-- CreateIndex
CREATE INDEX "patients_organization_id_name_search_idx" ON "patients"."patients"("organization_id", "name_search");

-- CreateIndex
CREATE UNIQUE INDEX "patients_organization_id_cpf_hash_key" ON "patients"."patients"("organization_id", "cpf_hash");

-- CreateIndex
CREATE INDEX "phones_number_idx" ON "patients"."phones"("number");

-- CreateIndex
CREATE UNIQUE INDEX "phones_patient_id_position_key" ON "patients"."phones"("patient_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_patient_id_kind_position_key" ON "patients"."contacts"("patient_id", "kind", "position");

-- CreateIndex
CREATE UNIQUE INDEX "versions_patient_id_version_key" ON "patients"."versions"("patient_id", "version");

-- AddForeignKey
ALTER TABLE "patients"."patients" ADD CONSTRAINT "patients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "org"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients"."phones" ADD CONSTRAINT "phones_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients"."contacts" ADD CONSTRAINT "contacts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients"."versions" ADD CONSTRAINT "versions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"."patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restrições que o Prisma não expressa no esquema.
ALTER TABLE "patients"."patients"
  ADD CONSTRAINT "patients_birth_date_range" CHECK ("birth_date" >= DATE '1900-01-01'),
  ADD CONSTRAINT "patients_cpf_pair" CHECK (("cpf_enc" IS NULL) = ("cpf_hash" IS NULL)),
  ADD CONSTRAINT "patients_address_zip_digits" CHECK ("address_zip" IS NULL OR "address_zip" ~ '^[0-9]{8}$'),
  ADD CONSTRAINT "patients_email_lowercase" CHECK ("email" IS NULL OR "email" = lower("email")),
  ADD CONSTRAINT "patients_version_positive" CHECK ("version" >= 1);

ALTER TABLE "patients"."phones"
  ADD CONSTRAINT "phones_number_format" CHECK ("number" ~ '^[1-9]{2}(9[0-9]{8}|[2-8][0-9]{7})$');

ALTER TABLE "patients"."contacts"
  ADD CONSTRAINT "contacts_phone_format" CHECK ("phone" IS NULL OR "phone" ~ '^[1-9]{2}(9[0-9]{8}|[2-8][0-9]{7})$'),
  ADD CONSTRAINT "contacts_emergency_has_phone" CHECK ("kind" <> 'emergency' OR "phone" IS NOT NULL);

-- Versões do cadastro: somente-acréscimo.
CREATE FUNCTION "patients"."reject_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%.% aceita apenas inclusão (% recusado)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "versions_append_only"
  BEFORE UPDATE OR DELETE ON "patients"."versions"
  FOR EACH ROW EXECUTE FUNCTION "patients"."reject_change"();
