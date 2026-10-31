#!/usr/bin/env bash
# Backup lógico do banco, já criptografado (docs/operacao/backup-e-restauracao.md).
#
#   DATABASE_URL_BACKUP=postgresql://...  BACKUP_DIR=/caminho  AGE_RECIPIENTS_FILE=/caminho/chaves.pub \
#     scripts/ops/backup.sh
#
# O dump nunca toca o disco sem criptografia: sai do pg_dump direto para o age, que cifra com a
# chave PÚBLICA. A chave privada fica fora do servidor e só é usada para restaurar.
# Gera <BACKUP_DIR>/crm-<data UTC>.dump.age e o .sha256 do arquivo cifrado.
set -euo pipefail
umask 077

: "${DATABASE_URL_BACKUP:?Defina DATABASE_URL_BACKUP (papel com leitura de todo o banco).}"
: "${BACKUP_DIR:?Defina BACKUP_DIR (pasta de destino).}"
: "${AGE_RECIPIENTS_FILE:?Defina AGE_RECIPIENTS_FILE (chaves públicas do age).}"
for cmd in pg_dump age sha256sum; do
  command -v "$cmd" >/dev/null || { echo "Falta o programa $cmd." >&2; exit 1; }
done
[ -s "$AGE_RECIPIENTS_FILE" ] || { echo "Arquivo de chaves públicas vazio ou ausente." >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/crm-$stamp.dump.age"
tmp="$out.parcial"
trap 'rm -f "$tmp"' EXIT

# Formato custom (comprimido, restaurável por tabela). Sem dono e sem permissões: na restauração
# os papéis são recriados pelos scripts de scripts/db.
pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL_BACKUP" |
  age --encrypt --recipients-file "$AGE_RECIPIENTS_FILE" --output "$tmp"

mv "$tmp" "$out"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256")
echo "Backup criado: $out ($(du -h "$out" | cut -f1))"
