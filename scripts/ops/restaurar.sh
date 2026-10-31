#!/usr/bin/env bash
# Restaura um backup cifrado num banco VAZIO (docs/operacao/backup-e-restauracao.md).
#
#   AGE_IDENTITY_FILE=/caminho/chave-privada.txt RESTORE_DATABASE_URL=postgresql://.../crm_restore \
#     scripts/ops/restaurar.sh /caminho/crm-AAAAMMDDTHHMMSSZ.dump.age
#
# Por segurança só restaura em banco cujo nome termina em _restore ou _test, e só se estiver vazio.
# Restaurar em produção é decisão do responsável e segue o plano de incidentes, nunca este atalho.
set -euo pipefail

file="${1:?Informe o arquivo .dump.age.}"
: "${AGE_IDENTITY_FILE:?Defina AGE_IDENTITY_FILE (chave privada do age).}"
: "${RESTORE_DATABASE_URL:?Defina RESTORE_DATABASE_URL (banco vazio de destino).}"

db_name="${RESTORE_DATABASE_URL##*/}"
db_name="${db_name%%\?*}"
case "$db_name" in
  *_restore | *_test) ;;
  *) echo "Recusado: o banco de destino ($db_name) precisa terminar em _restore ou _test." >&2; exit 1 ;;
esac

if [ -f "$file.sha256" ]; then
  (cd "$(dirname "$file")" && sha256sum --check --quiet "$(basename "$file").sha256") ||
    { echo "O resumo SHA-256 não confere: arquivo corrompido ou alterado." >&2; exit 1; }
else
  echo "Aviso: sem arquivo .sha256 ao lado do backup; integridade não conferida." >&2
fi

tables="$(psql "$RESTORE_DATABASE_URL" -Atc \
  "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")"
if [ "$tables" != "0" ]; then
  echo "Recusado: o banco de destino não está vazio ($tables tabelas)." >&2
  exit 1
fi

age --decrypt --identity "$AGE_IDENTITY_FILE" "$file" |
  pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE_URL"
echo "Restaurado em $db_name. Rode scripts/db/papel-aplicacao.sql antes de ligar a API nele."
