# ADR 0002: TypeScript de ponta a ponta

- **Status:** aceito (2026-10-19, aprovado pelo responsável do projeto)
- **Decisão:** TypeScript estrito no frontend, backend, scripts e pacotes compartilhados.
- **Motivo:** Validações (Zod) e tipos são escritos uma vez e usados na tela e no servidor. Linguagem com maior oferta de desenvolvedores no Brasil, facilitando a transferência.
- **Alternativas descartadas:** Python/Django no backend (duas linguagens; admin automático seria porta para dados clínicos).
- **Riscos:** Ecossistema npm exige atenção a dependências. Mitigação: versões travadas, npm audit e Dependabot no CI.
- **Revisar quando:** Equipe contratada for majoritariamente Python.
