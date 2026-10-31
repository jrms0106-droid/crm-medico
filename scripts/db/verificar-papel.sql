-- Confere que o papel da aplicação NÃO tem poderes de dono (docs/operacao/banco-e-papeis.md).
-- Rodar conectado como crm_app:
--   psql "$DATABASE_URL_APP" -v ON_ERROR_STOP=1 -f scripts/db/verificar-papel.sql
-- Cada comando abaixo precisa ser recusado; se algum passar, o script termina com erro.
DO $$
DECLARE
  attempt text;
  attempts text[] := ARRAY[
    'DELETE FROM audit.events WHERE false',
    'UPDATE audit.events SET reason = reason WHERE false',
    'ALTER TABLE audit.events DISABLE TRIGGER ALL',
    'ALTER TABLE records.clinical_records DISABLE TRIGGER ALL',
    'TRUNCATE records.clinical_records',
    'TRUNCATE billing.payments',
    'DROP TABLE billing.payments',
    'CREATE TABLE org.intrusa (id int)',
    'SELECT 1 FROM public._prisma_migrations LIMIT 1'
  ];
BEGIN
  IF current_user <> 'crm_app' THEN
    RAISE EXCEPTION 'Rode este script conectado como crm_app (conectado como %).', current_user;
  END IF;
  FOREACH attempt IN ARRAY attempts LOOP
    BEGIN
      EXECUTE attempt;
      RAISE EXCEPTION 'FALHA: o papel da aplicação conseguiu executar: %', attempt
        USING ERRCODE = 'P0001';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'recusado, como esperado: %', attempt;
    END;
  END LOOP;
  -- E o uso normal continua possível.
  PERFORM count(*) FROM audit.events;
  PERFORM count(*) FROM records.clinical_records;
  RAISE NOTICE 'Papel da aplicação conferido: % recusas e leitura normal.', array_length(attempts, 1);
END
$$;
