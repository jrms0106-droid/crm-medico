# Requisitos para escolher a hospedagem

> Nada foi contratado. Esta lista serve para comparar ofertas; a escolha e a contratação
> dependem da autorização do responsável. Comparação de ofertas públicas em
> [comparativo-de-fornecedores.md](comparativo-de-fornecedores.md).

## Obrigatórios

- **Região no Brasil** (por exemplo, São Paulo) para banco, servidor e backups principais.
- **PostgreSQL 16 gerenciado** com criptografia em repouso, backup automático e recuperação para
  um ponto no tempo; possibilidade de criar papéis (`crm_app`) e de rodar `pg_dump`.
- **HTTPS** com certificado gerenciado e HSTS; proxy que permita limite de requisições.
- **Cofre de segredos** para as chaves (`PII_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`), a senha de
  `crm_app` e o `DATABASE_URL`; nada disso em arquivo no repositório.
- **Contrato com cláusulas de proteção de dados** (papel de operador na LGPD), localização dos
  dados, aviso de incidente e devolução ou eliminação dos dados ao fim do contrato.
- Registro de acesso administrativo ao ambiente (quem entrou no servidor e no banco).
- Armazenamento para backups em outra região ou outro provedor.

## Desejáveis

- Certificações do provedor (por exemplo, ISO/IEC 27001) — são do provedor, não deste sistema.
- Alertas de disponibilidade e de uso de disco por e-mail ou mensagem.
- Ambiente de homologação separado, com dados fictícios, igual ao de produção.

## Porte

Para até 5 médicos e 10 a 30 consultas por dia: 1 servidor pequeno (2 vCPU, 2–4 GB) para a API
e o site, e o menor plano de PostgreSQL gerenciado com backup. Revisar com o uso real.

## Configuração mínima no primeiro deploy

1. `NODE_ENV=production` (a API recusa cookie sem HTTPS e chaves públicas de desenvolvimento).
2. `npx prisma migrate deploy` com o papel dono; depois `scripts/db/papel-aplicacao.sql` e
   `scripts/db/verificar-papel.sql`.
3. API com `DATABASE_URL` de `crm_app`; `TRUST_PROXY` com o **número** de proxies na frente da
   API (normalmente `1`). Número errado faz o limite de login por IP olhar o endereço errado.
4. Servidor do site com os cabeçalhos de `SECURITY_HEADERS` em `apps/web/vite.config.ts`
   (política de conteúdo, `nosniff`, `no-referrer`, sem moldura) e HSTS.
5. Proxy **sem registrar a query string** dos endereços da API (a busca de paciente pode levar
   CPF ou telefone) e sem guardar corpo de requisição nem cookie.
6. Backup diário agendado e o primeiro ensaio de restauração registrado.
7. Primeira verificação da trilha de auditoria e cópia do resumo da cabeça da cadeia fora do banco.
