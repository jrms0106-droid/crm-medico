# ADR 0010: Uma organização, várias unidades

- **Status:** aceito (2026-10-19, aprovado pelo responsável do projeto)
- **Decisão:** Todo dado operacional tem `unit_id`; o prontuário é do paciente na organização. Organizações juridicamente independentes ficam em instalações separadas.
- **Motivo:** Atende à expansão prevista sem a complexidade de multi-tenant.
- **Alternativas descartadas:** Multi-tenant completo com isolamento por tenant.
- **Riscos:** Vazamento entre unidades. Mitigação: unidade é atributo obrigatório na política e há testes de isolamento.
- **Revisar quando:** Atender organização juridicamente independente.
