# ADR 0004: NestJS no backend

- **Status:** aceito (2026-10-19, aprovado pelo responsável do projeto)
- **Decisão:** NestJS 12 (ESM) sobre Node.js 22 LTS, compilado com tsc.
- **Motivo:** Módulos explícitos, injeção de dependências e guards/interceptors tornam natural forçar autorização e auditoria em todas as rotas.
- **Alternativas descartadas:** Express/Fastify puros (menos estrutura), Django (ver ADR 0002).
- **Riscos:** Framework pesado para iniciantes. Mitigação: documentação e padrões repetidos em todos os módulos.
- **Revisar quando:** —
