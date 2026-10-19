# ADR 0014: Vínculo assistencial calculado a cada pedido, e não gravado

- **Status:** aceito (2026-10-19, Etapa 5)
- **Decisão:**
  - O estado do vínculo entre médico e paciente não tem tabela própria. A API o calcula a cada pedido a partir das consultas (`scheduling.appointments`), dos atendimentos (`care.encounters`) e do acesso emergencial (`care.emergency_accesses`), e o entrega ao motor de política como contexto.
  - O que cada estado libera fica numa matriz única no `@crm/policy` (`CARE_MATRIX`), testada estado por estado.
  - Os prazos (cortesia de 30 dias e acesso emergencial de 4 horas) são configuráveis por variável de ambiente.
- **Motivo:** Um estado gravado precisaria de tarefas agendadas para expirar e poderia ficar desatualizado se uma consulta fosse cancelada ou um prazo mudasse. Calculado, a expiração acontece sozinha, no próprio pedido, e não há como o vínculo "esquecer" de expirar.
- **Alternativas descartadas:**
  - Tabela de vínculos com estado e tarefa de expiração (pg-boss): mais uma peça para falhar, e uma janela entre o fim do prazo e a execução da tarefa.
  - Regras de vínculo espalhadas pelos serviços: dificultaria a validação médica e a auditoria das regras.
- **Consequências:**
  - Cada acesso clínico faz algumas consultas extras ao banco, cobertas por índices. Se pesar, dá para guardar o resultado por alguns segundos.
  - O motivo de cada decisão vai para a auditoria (`care_state_disallows`, `not_author`, `justification_required`, `emergency_access`).
- **Riscos:** A tabela de estados é uma proposta técnica. Até a validação médica, não há uso clínico real.
- **Revisar quando:** Os médicos validarem a tabela, ou se o custo do cálculo aparecer nas medições de desempenho.
