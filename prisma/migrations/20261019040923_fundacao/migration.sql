-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "org";

-- CreateTable
CREATE TABLE "org"."organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org"."units" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "units_organization_id_idx" ON "org"."units"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "units_organization_id_name_key" ON "org"."units"("organization_id", "name");

-- AddForeignKey
ALTER TABLE "org"."units" ADD CONSTRAINT "units_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "org"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
