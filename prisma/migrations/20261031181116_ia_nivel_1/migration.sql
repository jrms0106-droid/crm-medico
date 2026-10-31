-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ai";

-- CreateEnum
CREATE TYPE "ai"."AiFeature" AS ENUM ('message_draft', 'request_triage');

-- CreateEnum
CREATE TYPE "ai"."AiDecision" AS ENUM ('draft', 'accepted', 'discarded');

-- CreateTable
CREATE TABLE "ai"."feature_settings" (
    "organization_id" UUID NOT NULL,
    "feature" "ai"."AiFeature" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_settings_pkey" PRIMARY KEY ("organization_id","feature")
);

-- CreateTable
CREATE TABLE "ai"."requests" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "feature" "ai"."AiFeature" NOT NULL,
    "purpose" VARCHAR(60) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "model_version" VARCHAR(40) NOT NULL,
    "input_sha256" CHAR(64) NOT NULL,
    "input_chars" INTEGER NOT NULL,
    "output" VARCHAR(4000) NOT NULL,
    "output_meta" JSONB NOT NULL DEFAULT '{}',
    "decision" "ai"."AiDecision" NOT NULL DEFAULT 'draft',
    "edited" BOOLEAN,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "requests_organization_id_created_at_idx" ON "ai"."requests"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "requests_user_id_created_at_idx" ON "ai"."requests"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai"."feature_settings" ADD CONSTRAINT "feature_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "org"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai"."feature_settings" ADD CONSTRAINT "feature_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai"."requests" ADD CONSTRAINT "requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "org"."organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai"."requests" ADD CONSTRAINT "requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai"."requests" ADD CONSTRAINT "requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Regras do registro de uso da IA (docs/api/ia-nivel-1.md).

ALTER TABLE "ai"."requests"
  ADD CONSTRAINT "requests_input_sha256_hex" CHECK ("input_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "requests_input_chars_positive" CHECK ("input_chars" >= 0),
  ADD CONSTRAINT "requests_decision_coherent" CHECK (
    ("decision" = 'draft') = ("decided_at" IS NULL)
    AND ("decision" = 'draft') = ("decided_by_user_id" IS NULL)
    AND (("decision" = 'accepted') = ("edited" IS NOT NULL))
  );

-- Registro de uso: nada é apagado; só a decisão humana pode ser gravada, uma única vez.
CREATE FUNCTION "ai"."protect_request"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Registro de uso da IA não pode ser apagado.';
  END IF;
  IF OLD."decision" <> 'draft' THEN
    RAISE EXCEPTION 'A decisão sobre este uso da IA já foi registrada.';
  END IF;
  IF NEW."organization_id" <> OLD."organization_id"
     OR NEW."user_id" <> OLD."user_id"
     OR NEW."feature" <> OLD."feature"
     OR NEW."purpose" <> OLD."purpose"
     OR NEW."provider" <> OLD."provider"
     OR NEW."model" <> OLD."model"
     OR NEW."model_version" <> OLD."model_version"
     OR NEW."input_sha256" <> OLD."input_sha256"
     OR NEW."input_chars" <> OLD."input_chars"
     OR NEW."output" <> OLD."output"
     OR NEW."output_meta" <> OLD."output_meta"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'Só a decisão humana pode ser registrada num uso da IA.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "requests_protect"
  BEFORE UPDATE OR DELETE ON "ai"."requests"
  FOR EACH ROW EXECUTE FUNCTION "ai"."protect_request"();
