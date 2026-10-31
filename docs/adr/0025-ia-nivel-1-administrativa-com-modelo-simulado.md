# ADR 0025: IA nível 1 administrativa, com gateway, modelo simulado e revisão humana

- **Status:** aceito (2026-10-31, fase IA nível 1)
- **Decisão:**
  - O módulo `ai` da API é o único ponto de contato com modelos de linguagem (cumpre o ADR 0009). Ele confere o interruptor da funcionalidade, monta a entrada com o mínimo de dados, chama o adaptador `LanguageModel`, confere a saída e grava o registro de uso.
  - O único adaptador é o `SimulatedModel`: regras fixas e modelos de texto dentro da API. Nada sai do sistema.
  - Primeiras funcionalidades: rascunho de mensagem administrativa (`message_draft`) e classificação de pedidos dos pacientes (`request_triage`), só para a secretária.
  - Interruptor por funcionalidade e por organização em `ai.feature_settings`, desligado por padrão, mudado só pelo administrador com reautenticação.
  - Registro de uso em `ai.requests`: fornecedor, modelo, versão, finalidade, quem pediu, resumo SHA-256 e tamanho da entrada (nunca a entrada), a saída e a decisão humana, gravada uma vez. Gatilho no banco impede apagar e mudar o resto.
  - Proteção contra prompt injection: texto de fora entre delimitadores neutralizados, instrução fixa de tratar como dado, saída conferida contra formato fixo e nenhuma ferramenta à disposição do modelo.
- **Motivo:** A especificação manda começar a IA pelo nível administrativo e só depois do documental e do clínico; contratar um fornecedor exige autorização e avaliação de contrato, retenção, transferência internacional e uso para treinamento. Com o modelo simulado, todo o caminho (permissão, minimização, registro, revisão) fica pronto e testado, e trocar de fornecedor é escrever um adaptador.
- **Alternativas descartadas:**
  - Chamar um fornecedor direto agora: exige contrato e credenciais e mandaria dados para fora sem avaliação.
  - Guardar a entrada no registro: facilitaria a auditoria, mas guardaria texto de paciente sem necessidade (minimização).
  - Ligar as funcionalidades por padrão: o responsável deve decidir o uso de IA na clínica.
- **Consequências:** As sugestões do modelo simulado são simples (palavras-chave e modelos de texto). O prazo de guarda de `ai.requests` precisa ser decidido com a avaliação jurídica. Organização de agenda e relatório assistido vieram depois (ADR 0026).
- **Revisar quando:** O responsável autorizar um fornecedor de IA (novo adaptador, avaliação de contrato e privacidade), começar o nível 2 (documental, com dados clínicos) ou a classificação precisar de algo além de palavras-chave.
