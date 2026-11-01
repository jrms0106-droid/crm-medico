# ADR 0027: teste automático de acessibilidade com axe-core no e2e

- **Status:** aceito (2026-11-01, revisão geral)
- **Decisão:** O e2e roda o axe-core (`@axe-core/playwright`, só em desenvolvimento) nas telas de cada perfil, com as regras WCAG 2.1 A e AA. Qualquer violação reprova o teste e, portanto, o CI.
- **Motivo:** A especificação pede acessibilidade, e uma tela nova pode quebrá-la sem ninguém perceber. O axe é a ferramenta aberta mais usada para isso e roda no mesmo navegador do e2e.
- **Alternativas descartadas:** Lighthouse (mais pesado e mistura desempenho); só revisão manual (não pega regressões a cada PR).
- **Consequências:** Mais cerca de 30 segundos no e2e. O axe pega só parte dos problemas; teste com leitor de tela e com pessoas continua necessário. Licença MPL-2.0, usada só nos testes.
- **Revisar quando:** O app ganhar telas fora do menu que precisem de varredura própria, ou a clínica definir um nível de conformidade diferente.
