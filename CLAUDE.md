# Instruções para agentes neste repositório

- Especificação: Prompt Mestre 10.0 (resumido em `docs/planejamento/`). Ordem de trabalho em `docs/planejamento/04-plano-do-mvp.md`.
- Textos de interface, documentação e mensagens de erro em português do Brasil; identificadores de código em inglês.
- Somente dados fictícios. Não contratar serviços pagos, publicar em produção nem usar dados reais sem autorização explícita do responsável.
- Antes de alterações relevantes, registrar plano, arquivos afetados, riscos e critérios de aceite na descrição do PR.
- Autorização sempre no backend, via `@crm/policy`, com negação por padrão. Toda nova rota precisa de teste de acesso permitido e negado.
- Mudanças no banco só por migração nova em `prisma/migrations` (nunca editar migração já aplicada).
- Antes de abrir PR: `npm run build && npm run check` devem passar. Não declarar testes aprovados sem a saída real.
- Testes de integração precisam de PostgreSQL local; no contêiner na nuvem: `sudo pg_ctlcluster 16 main start` e criar o papel `crm` e os bancos `crm_dev` e `crm_test` (ver `.env.example`).
- Decisões técnicas novas viram ADR em `docs/adr/`.
