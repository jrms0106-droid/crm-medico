# Backup e restauração

> Os scripts estão prontos e testados com dados fictícios. **Agendar, guardar as cópias e
> escolher o local** depende da hospedagem, que ainda não foi contratada.

## Como funciona

- `scripts/ops/backup.sh` faz o dump lógico (`pg_dump`, formato custom) e o cifra na hora com
  [age](https://age-encryption.org), usando a chave **pública**. O dump nunca fica no disco sem
  criptografia. Gera `crm-<data UTC>.dump.age` e o `.sha256` do arquivo cifrado.
- `scripts/ops/restaurar.sh` confere o SHA-256, decifra com a chave **privada** e restaura num
  banco **vazio**. Por segurança, só aceita destino com nome terminado em `_restore` ou `_test`.
- `scripts/ops/ensaio-de-restauracao.sh` faz os dois e compara origem e cópia: tabelas,
  quantidade de linhas, resumo MD5 do conteúdo de cada tabela, gatilhos e a trilha de auditoria
  recalculada elo por elo. Termina com erro se algo diferir.

O dump sai sem dono e sem permissões; depois de restaurar, rode
[`scripts/db/papel-aplicacao.sql`](banco-e-papeis.md) antes de ligar a API.

## Chaves

- Par gerado com `age-keygen`. A chave pública fica no servidor de backup; a **privada fica
  fora do servidor**, em dois lugares seguros (por exemplo, cofre de senhas do responsável e
  cópia impressa em local trancado). Sem ela, nenhum backup pode ser lido, nem por quem roubar o
  servidor.
- As chaves `PII_ENCRYPTION_KEY` e `MFA_ENCRYPTION_KEY` também precisam de cópia segura fora do
  servidor: sem elas, o CPF e os segredos de MFA restaurados ficam ilegíveis.

## Política proposta (a confirmar com o responsável)

| Item                   | Proposta                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Frequência             | diário, de madrugada, além do backup automático do banco gerenciado da hospedagem             |
| Cópias                 | 30 diárias, 12 mensais e 1 por ano mantida pelo prazo de guarda do prontuário (validar)       |
| Local                  | outro provedor ou outra região, além do servidor principal                                    |
| Perda máxima aceitável | 24 horas (só o backup diário); menor se a hospedagem tiver recuperação para um ponto no tempo |
| Tempo para voltar      | até 4 horas para restaurar e conferir                                                         |
| Ensaio                 | automático no CI a cada mudança; mensal com uma cópia real, em banco separado, registrado     |

## Evidência do ensaio

Rodado em 2026-10-30, no banco de teste com os dados fictícios dos testes ponta a ponta:

```text
Backup: crm-20261030T235722Z.dump.age (128K), cifrado com age
Tabelas conferidas: 31
Linhas na origem: 156
Gatilhos: 13
Eventos de auditoria verificados: 92; elos quebrados: 0
RESULTADO: OK — conteúdo idêntico e trilha de auditoria íntegra.
```

Prova de que a conferência pega adulteração: na cópia restaurada, um evento de auditoria foi
alterado com os gatilhos desligados (como só o dono consegue); a mesma verificação acusou
"92 verificados, 1 quebrados". O ensaio também roda no CI em todo PR.

## Como rodar o ensaio

```bash
createdb crm_restore   # banco vazio, como superusuário ou papel com CREATEDB
SOURCE_DATABASE_URL="postgresql://crm:...@localhost:5432/crm_test" \
RESTORE_DATABASE_URL="postgresql://crm:...@localhost:5432/crm_restore" \
  scripts/ops/ensaio-de-restauracao.sh pasta-do-relatorio
```

Sem `AGE_RECIPIENTS_FILE`, o ensaio usa um par de chaves descartável.
