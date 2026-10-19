# ADR 0008: Fila no PostgreSQL (pg-boss)

- **Status:** aceito (2026-10-19, aprovado pelo responsável do projeto)
- **Decisão:** Tarefas assíncronas (lembretes, anexos, IA) usam fila dentro do próprio PostgreSQL.
- **Motivo:** Volume baixo; um componente a menos para proteger, pagar e fazer backup.
- **Alternativas descartadas:** Redis + BullMQ.
- **Riscos:** Throughput limitado. Irrelevante no porte atual.
- **Revisar quando:** Volume de mensagens alto.
