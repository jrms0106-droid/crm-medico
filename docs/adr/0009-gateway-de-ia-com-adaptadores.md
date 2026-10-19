# ADR 0009: Gateway de IA com adaptadores

- **Status:** aceito (2026-10-19, aprovado pelo responsável do projeto)
- **Decisão:** Nenhum módulo chama provedor de IA diretamente; o módulo `ai` concentra adaptadores, minimização de dados, registro de uso e interruptores por funcionalidade.
- **Motivo:** Permite trocar provedor sem reescrever e desligar IA sem afetar módulos essenciais.
- **Alternativas descartadas:** Chamadas diretas a SDKs de provedores.
- **Riscos:** —
- **Revisar quando:** —
