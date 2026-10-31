-- Papel de banco da APLICAÇÃO em produção (docs/operacao/banco-e-papeis.md).
--
-- A API conecta com `crm_app`, que só lê e grava dados. Ele não é dono de nada: não cria nem
-- altera tabelas, não desliga gatilhos, não apaga tabelas inteiras (TRUNCATE) e, na trilha de
-- auditoria, só lê e acrescenta. As migrações continuam rodando com o papel dono (`crm`).
--
-- Rodar como o papel dono, depois de cada `prisma migrate deploy`:
--   psql "$DATABASE_URL_OWNER" -v ON_ERROR_STOP=1 -f scripts/db/papel-aplicacao.sql
-- A senha de `crm_app` é definida à parte (nunca neste arquivo):
--   psql "$DATABASE_URL_OWNER" -c '\password crm_app'
-- Criar o papel exige CREATEROLE; se o dono não tiver, um administrador do banco roda só o
-- bloco DO abaixo antes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_app') THEN
    CREATE ROLE crm_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

DO $$
DECLARE
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'org', 'identity', 'audit', 'patients', 'scheduling', 'care', 'records', 'documents', 'billing',
    'privacy', 'crm', 'ai'
  ] LOOP
    -- Começa do zero a cada execução, para nenhuma permissão antiga sobrar.
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM crm_app', s);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM crm_app', s);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO crm_app', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO crm_app', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO crm_app', s);
  END LOOP;
END
$$;

-- Trilha de auditoria: só ler e acrescentar. Os gatilhos já recusam alteração e exclusão; sem a
-- permissão, a recusa vem antes, e o papel também não consegue desligar os gatilhos.
REVOKE UPDATE, DELETE ON audit.events FROM crm_app;

-- Nada no esquema public (onde fica o controle de migrações do Prisma).
REVOKE ALL ON SCHEMA public FROM crm_app;
