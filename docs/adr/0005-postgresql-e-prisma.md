# ADR 0005: PostgreSQL + Prisma

- **Status:** aceito (2026-10-19, aprovado pelo responsável do projeto)
- **Decisão:** PostgreSQL 16 e Prisma 7 com driver adapter `pg`. Migrações versionadas em `prisma/migrations`; SQL manual nas migrações para gatilhos e restrições que o Prisma não expressa.
- **Motivo:** Transações, restrições de integridade, JSONB, gatilhos para imutabilidade e trilha de auditoria, índices sem acento. Prisma é amplamente conhecido e gera tipos do banco.
- **Alternativas descartadas:** MySQL, MongoDB; Drizzle e TypeORM como ORM.
- **Riscos:** Prisma pode limitar SQL avançado. Mitigação: `$queryRaw` tipado e SQL em migrações.
- **Revisar quando:** O ORM atrapalhar mais do que ajudar em consultas críticas.
