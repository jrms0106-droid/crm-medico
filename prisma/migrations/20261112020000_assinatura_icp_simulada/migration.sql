-- Assinatura ICP-Brasil, só simulada (ADR 0046): segunda assinatura em tabela própria, só de acréscimo.
CREATE TABLE "documents"."qualified_signatures" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "signer_user_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "reference" VARCHAR(120) NOT NULL,
    "simulated" BOOLEAN NOT NULL,
    "signed_content_hash" CHAR(64) NOT NULL,
    "signed_at" TIMESTAMPTZ(3) NOT NULL,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "qualified_signatures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "qualified_signatures_document_id_key" ON "documents"."qualified_signatures"("document_id");

ALTER TABLE "documents"."qualified_signatures" ADD CONSTRAINT "qualified_signatures_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"."medical_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enquanto só existir o adaptador simulado, o banco não aceita nada que se passe por real.
ALTER TABLE "documents"."qualified_signatures"
  ADD CONSTRAINT "qualified_signatures_only_simulated" CHECK ("simulated" = true AND "provider" = 'simulado'),
  ADD CONSTRAINT "qualified_signatures_hash_format" CHECK ("signed_content_hash" ~ '^[0-9a-f]{64}$');

-- Só documento assinado, com o mesmo resumo gravado e pelo próprio autor.
CREATE FUNCTION "documents"."check_qualified_signature"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  doc RECORD;
BEGIN
  SELECT "status", "content_hash", "author_user_id" INTO doc
    FROM "documents"."medical_documents" WHERE "id" = NEW."document_id" FOR SHARE;
  IF doc."status" IS DISTINCT FROM 'signed' THEN
    RAISE EXCEPTION 'Só documento assinado recebe assinatura ICP-Brasil.';
  END IF;
  IF doc."content_hash" IS DISTINCT FROM NEW."signed_content_hash" THEN
    RAISE EXCEPTION 'O resumo assinado não confere com o documento.';
  END IF;
  IF doc."author_user_id" <> NEW."signer_user_id" THEN
    RAISE EXCEPTION 'Só o autor assina o documento.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "qualified_signatures_checked"
  BEFORE INSERT ON "documents"."qualified_signatures"
  FOR EACH ROW EXECUTE FUNCTION "documents"."check_qualified_signature"();

CREATE TRIGGER "qualified_signatures_append_only"
  BEFORE UPDATE OR DELETE ON "documents"."qualified_signatures"
  FOR EACH ROW EXECUTE FUNCTION "documents"."reject_change"();
