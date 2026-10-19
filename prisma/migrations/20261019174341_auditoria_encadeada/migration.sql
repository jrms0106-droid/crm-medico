-- AlterTable
ALTER TABLE "audit"."events" ADD COLUMN     "chain_seq" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "hash" CHAR(64) NOT NULL DEFAULT ''::bpchar,
ADD COLUMN     "prev_hash" CHAR(64);

-- CreateIndex
CREATE INDEX "events_organization_id_chain_seq_idx" ON "audit"."events"("organization_id", "chain_seq");

-- Encadeamento por hash (docs/api/auditoria.md, ADR 0016).

-- Resumo SHA-256 de um evento: todos os campos, a posição na cadeia e o resumo anterior,
-- num array JSON (sem ambiguidade entre campos vazios e separadores). A data vai em UTC,
-- com milissegundos, para o resultado não depender do fuso da sessão.
CREATE FUNCTION "audit"."event_digest"(e "audit"."events") RETURNS char(64)
  LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    e."prev_hash",
    e."chain_seq",
    e."id",
    to_char(e."occurred_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    e."organization_id",
    e."actor_user_id",
    e."session_id",
    e."request_id",
    e."ip",
    e."action",
    e."resource_type",
    e."resource_id",
    e."unit_id",
    e."patient_id",
    e."outcome",
    e."reason",
    e."emergency"
  )::text, 'UTF8')), 'hex')::char(64)
$$;

-- Cada evento entra no fim da cadeia da sua organização. A trava por organização impede
-- que dois eventos simultâneos usem o mesmo elo anterior.
CREATE FUNCTION "audit"."chain_event"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  last_seq bigint;
  last_hash char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('audit-chain:' || coalesce(NEW."organization_id"::text, '-'), 0)
  );
  IF NEW."organization_id" IS NULL THEN
    SELECT "chain_seq", "hash" INTO last_seq, last_hash FROM "audit"."events"
      WHERE "organization_id" IS NULL ORDER BY "chain_seq" DESC LIMIT 1;
  ELSE
    SELECT "chain_seq", "hash" INTO last_seq, last_hash FROM "audit"."events"
      WHERE "organization_id" = NEW."organization_id" ORDER BY "chain_seq" DESC LIMIT 1;
  END IF;
  NEW."chain_seq" := coalesce(last_seq, 0) + 1;
  NEW."prev_hash" := last_hash;
  NEW."hash" := "audit"."event_digest"(NEW);
  RETURN NEW;
END;
$$;

-- Encadeia os eventos que já existem, na ordem de gravação.
ALTER TABLE "audit"."events" DISABLE TRIGGER "events_append_only";
DO $$
DECLARE
  r "audit"."events";
  last_org uuid;
  first_row boolean := true;
  pos bigint := 0;
  last_hash char(64);
BEGIN
  FOR r IN SELECT * FROM "audit"."events" ORDER BY "organization_id" NULLS FIRST, "seq" LOOP
    IF first_row OR r."organization_id" IS DISTINCT FROM last_org THEN
      pos := 0;
      last_hash := NULL;
      first_row := false;
    END IF;
    pos := pos + 1;
    r."chain_seq" := pos;
    r."prev_hash" := last_hash;
    r."hash" := "audit"."event_digest"(r);
    UPDATE "audit"."events"
      SET "chain_seq" = r."chain_seq", "prev_hash" = r."prev_hash", "hash" = r."hash"
      WHERE "id" = r."id";
    last_hash := r."hash";
    last_org := r."organization_id";
  END LOOP;
END;
$$;
ALTER TABLE "audit"."events" ENABLE TRIGGER "events_append_only";

CREATE UNIQUE INDEX "events_chain_position"
  ON "audit"."events" (coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid), "chain_seq");

ALTER TABLE "audit"."events"
  ADD CONSTRAINT "events_chained" CHECK ("chain_seq" >= 1 AND length("hash") = 64);

CREATE TRIGGER "events_chain"
  BEFORE INSERT ON "audit"."events"
  FOR EACH ROW EXECUTE FUNCTION "audit"."chain_event"();
