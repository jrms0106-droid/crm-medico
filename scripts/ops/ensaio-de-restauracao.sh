#!/usr/bin/env bash
# Ensaio de restauração: faz backup, restaura num banco vazio e confere que nada se perdeu
# (docs/operacao/backup-e-restauracao.md). Só com dados fictícios fora de produção.
#
#   SOURCE_DATABASE_URL=postgresql://.../crm_test RESTORE_DATABASE_URL=postgresql://.../crm_restore \
#     scripts/ops/ensaio-de-restauracao.sh [pasta-do-relatorio]
#
# Sem chaves informadas, gera um par de chaves age descartável só para o ensaio.
# Confere: mesmas tabelas, mesma quantidade de linhas e mesmo conteúdo (resumo MD5 de cada
# tabela), mesmos gatilhos de proteção, mesmas migrações e trilha de auditoria íntegra.
set -euo pipefail
umask 077

: "${SOURCE_DATABASE_URL:?Defina SOURCE_DATABASE_URL (banco de origem).}"
: "${RESTORE_DATABASE_URL:?Defina RESTORE_DATABASE_URL (banco vazio de destino).}"
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
report_dir="${1:-$work}"
mkdir -p "$report_dir"
report="$report_dir/ensaio-$(date -u +%Y%m%dT%H%M%SZ).txt"

if [ -z "${AGE_RECIPIENTS_FILE:-}" ]; then
  age-keygen -o "$work/chave.txt" 2>/dev/null
  age-keygen -y "$work/chave.txt" > "$work/chave.pub"
  export AGE_RECIPIENTS_FILE="$work/chave.pub" AGE_IDENTITY_FILE="$work/chave.txt"
fi

DATABASE_URL_BACKUP="$SOURCE_DATABASE_URL" BACKUP_DIR="$work/backups" "$here/backup.sh"
file="$(ls "$work"/backups/*.dump.age)"
"$here/restaurar.sh" "$file"

# Assinatura de cada tabela: nome, linhas e MD5 das linhas em ordem estável.
fingerprint() {
  psql "$1" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('select %L || ''|'' || count(*) || ''|'' || coalesce(md5(string_agg(t::text, E''\n'' order by t::text)), ''-'') from %I.%I t;',
              schemaname || '.' || tablename, schemaname, tablename)
  FROM pg_tables
 WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
 ORDER BY schemaname, tablename
\gexec
SELECT 'gatilhos|' || count(*) || '|' || md5(string_agg(c.relname || '.' || t.tgname, ',' ORDER BY c.relname, t.tgname))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal;
SQL
}

fingerprint "$SOURCE_DATABASE_URL" > "$work/origem.txt"
fingerprint "$RESTORE_DATABASE_URL" > "$work/restaurado.txt"

chain="$(psql "$RESTORE_DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "
  WITH chain AS (
    SELECT e.chain_seq, e.hash, e.prev_hash, audit.event_digest(e) AS expected,
           lag(e.hash) OVER w AS prev_actual, lag(e.chain_seq) OVER w AS prev_seq
      FROM audit.events e
    WINDOW w AS (PARTITION BY e.organization_id ORDER BY e.chain_seq))
  SELECT count(*) || '|' || count(*) FILTER (
           WHERE chain_seq <> coalesce(prev_seq, 0) + 1
              OR prev_hash IS DISTINCT FROM prev_actual
              OR hash <> expected)
    FROM chain")"
checked="${chain%%|*}"
broken="${chain##*|}"

{
  echo "Ensaio de restauração — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Backup: $(basename "$file") ($(du -h "$file" | cut -f1)), cifrado com age"
  echo "Tabelas conferidas: $(grep -vc '^gatilhos|' "$work/origem.txt")"
  echo "Linhas na origem: $(grep -v '^gatilhos|' "$work/origem.txt" | awk -F'|' '{s+=$2} END {print s}')"
  echo "Gatilhos: $(grep '^gatilhos|' "$work/restaurado.txt" | cut -d'|' -f2)"
  echo "Eventos de auditoria verificados: $checked; elos quebrados: $broken"
} > "$report"

status=0
if ! diff -u "$work/origem.txt" "$work/restaurado.txt" >> "$report"; then
  echo "RESULTADO: FALHOU — o banco restaurado difere da origem (diferenças acima)." >> "$report"
  status=1
elif [ "$broken" != "0" ] || [ "$checked" = "0" ]; then
  echo "RESULTADO: FALHOU — trilha de auditoria com elos quebrados ou vazia." >> "$report"
  status=1
else
  echo "RESULTADO: OK — conteúdo idêntico e trilha de auditoria íntegra." >> "$report"
fi
cat "$report"
exit "$status"
