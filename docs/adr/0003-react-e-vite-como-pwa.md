# ADR 0003: React + Vite como PWA

- **Status:** aceito (2026-10-19, aprovado pelo responsável do projeto)
- **Decisão:** Aplicação de página única (SPA) com React e Vite, instalável como PWA. Empacotamento com Capacitor só se loja de aplicativos for necessária.
- **Motivo:** Sistema 100% autenticado, sem necessidade de SEO ou renderização no servidor. Um código serve navegador, celular e computador.
- **Alternativas descartadas:** Next.js (segundo servidor sem benefício), Flutter (segunda linguagem, web fraca para formulários), nativo (três códigos).
- **Riscos:** Limitações de PWA no iOS. Mitigação: Capacitor sem reescrita.
- **Revisar quando:** Surgir portal público do paciente ou necessidade de loja.
