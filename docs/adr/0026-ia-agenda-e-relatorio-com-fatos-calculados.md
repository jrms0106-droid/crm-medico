# ADR 0026: organização da agenda e relatório assistido com fatos calculados pelo sistema

- **Status:** aceito (2026-10-31, fase IA nível 1)
- **Decisão:**
  - Duas funcionalidades novas no gateway do ADR 0025, desligadas por padrão: organização da agenda (`schedule_suggestions`, secretária) e relatório administrativo assistido (`admin_report`, administrador).
  - O **sistema calcula os fatos** e o modelo só trabalha sobre eles. Na agenda, o modelo recebe horários livres, consultas sem confirmação e a lista de espera com **códigos no lugar das pessoas** (`H1`, `E1`, `C1`) e devolve sugestões com esses códigos; o sistema confere cada código (existe, não repete) e só depois troca pelos nomes reais. No relatório, o modelo recebe só números agregados e **todo número do texto precisa estar entre os calculados** (ou nas datas do período).
  - Qualquer falha na conferência descarta a resposta inteira (502 `AI_INVALID_OUTPUT`) e nada é registrado.
  - Novo recurso de autorização `ai_report` (administrador: criar e editar a própria decisão). A organização da agenda passa também pela permissão de ver as consultas daquela agenda.
  - O histórico mostra o texto da saída a quem pediu; o administrador continua vendo o uso dos outros sem o texto.
- **Motivo:** A especificação proíbe a IA de inventar fatos. Separar "calcular" (sistema, testável) de "escolher e escrever" (modelo) torna a invenção verificável: um código ou número que o sistema não produziu é detectado antes de chegar à tela. Os códigos também cumprem a minimização: nome, CPF e telefone nunca vão ao modelo.
- **Alternativas descartadas:**
  - Mandar nomes e deixar o modelo montar o texto final: mais natural, mas manda dado pessoal sem necessidade e não deixa conferir.
  - Deixar a IA marcar a consulta direto: contraria a regra de que a IA não age sozinha.
  - Dar o relatório também à secretária: o resumo junta financeiro e números da organização, que são da gestão.
- **Consequências:** A conferência de números é por texto: um número permitido usado no lugar errado (por exemplo, o total de lembretes citado como total de consultas) não é pego; por isso a tela mostra os números do sistema ao lado do texto. "Pacientes novos" é da organização inteira, porque o cadastro não tem unidade.
- **Revisar quando:** Houver fornecedor de IA autorizado, o relatório precisar de comparação entre períodos ou a agenda precisar sugerir remarcações.
