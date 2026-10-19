# ADR 0007: Motor de autorização próprio (RBAC + ABAC)

- **Status:** aceito (2026-10-19, aprovado pelo responsável do projeto)
- **Decisão:** Pacote `@crm/policy`, puro e sem banco: recebe sujeito, ação, recurso e contexto e devolve permitir/negar com motivo. Negação por padrão; negação explícita vence; erro em regra nega.
- **Motivo:** Regras de vínculo assistencial são específicas do domínio e precisam ser 100% testáveis isoladamente.
- **Alternativas descartadas:** Casbin, OPA (mais uma linguagem de regras para manter).
- **Riscos:** Peça crítica. Mitigação: cobertura de testes exaustiva e revisão de segurança.
- **Revisar quando:** Regras ficarem complexas demais para código.
