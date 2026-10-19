# ADR 0001: Monólito modular

- **Status:** aceito (2026-10-19, aprovado pelo responsável do projeto)
- **Decisão:** Um único backend e um único banco, divididos em módulos com fronteiras rígidas (um schema PostgreSQL por módulo; só o dono escreve nas suas tabelas).
- **Motivo:** O porte (até 5 médicos, 10–30 consultas/dia) não justifica microsserviços. Um processo só é mais simples de proteger, testar, implantar e fazer backup.
- **Alternativas descartadas:** Microsserviços (custo operacional e pontos de falha desproporcionais).
- **Riscos:** Fronteiras podem ser violadas por atalhos. Mitigação: revisão de PR e, no futuro, regra de lint de importações entre módulos.
- **Revisar quando:** Um módulo precisar escalar ou ser implantado de forma independente.
