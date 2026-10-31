# Banco de dados: papéis e permissões

Em produção, a API **não** conecta com o papel dono do banco. São dois papéis:

| Papel     | Quem usa                                 | Pode                                                                                                                                                          |
| --------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crm`     | só as migrações e o backup (fora da API) | tudo: é o dono das tabelas                                                                                                                                    |
| `crm_app` | a API, o tempo todo                      | ler e gravar dados; na auditoria, só ler e acrescentar. Não cria nem altera tabelas, não desliga gatilhos, não usa `TRUNCATE`, não lê o controle de migrações |

**Por quê:** o dono de uma tabela consegue desligar os gatilhos que protegem o prontuário
assinado e a trilha de auditoria. Com a API em `crm_app`, nem uma falha na API dá esse poder a
quem a explorar. Decisão registrada no [ADR 0020](../adr/0020-papel-de-banco-da-aplicacao-e-backup-cifrado.md).

## Como aplicar

Depois de cada `npx prisma migrate deploy` (rodado com o papel dono):

```bash
psql "$DATABASE_URL_OWNER" -v ON_ERROR_STOP=1 -f scripts/db/papel-aplicacao.sql
```

O script é idempotente: recomeça as permissões do zero e concede só as necessárias, inclusive
às tabelas novas da migração. Se alguém esquecer de rodá-lo, a API recebe "permissão negada" na
tabela nova (falha fechada, nunca aberta). A senha de `crm_app` é definida uma vez, à parte
(`\password crm_app`), e vai só para o cofre de segredos da hospedagem.

## Como conferir

```bash
psql "$DATABASE_URL_APP" -v ON_ERROR_STOP=1 -f scripts/db/verificar-papel.sql
```

Tenta nove operações proibidas (apagar e alterar auditoria, desligar gatilhos, `TRUNCATE`,
`DROP`, criar tabela, ler as migrações) e termina com erro se alguma passar.

## Evidências

- No CI, depois dos testes de integração: aplica o papel, roda a conferência e roda **todos os
  testes ponta a ponta com a API conectada como `crm_app`** (`E2E_API_DATABASE_URL`).
- Localmente, em 2026-10-30: os 6 testes ponta a ponta passaram com a API em `crm_app`; a
  conferência recusou as 9 operações; e, com uma permissão de `DELETE` na auditoria concedida de
  propósito, a conferência falhou apontando o comando (prova de que o teste pega o erro).

## No ambiente de desenvolvimento

O papel `crm` local precisa de `CREATEROLE` para criar `crm_app` (uma vez, como superusuário:
`ALTER ROLE crm CREATEROLE`). Os testes de integração continuam com o papel dono, porque
recriam as tabelas a cada execução.
