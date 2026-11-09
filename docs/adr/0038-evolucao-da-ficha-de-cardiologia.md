# ADR 0038: evolução dos valores da ficha de cardiologia

- **Status:** aceito (2026-11-09, o responsável pediu para continuar depois da ficha de cardiologia)
- **Contexto:** Com a ficha de cardiologia ([ADR 0037](0037-ficha-de-cardiologia.md)), os números (PA, LDL, FEVE e outros) ficam guardados em cada registro. Para acompanhar o paciente, o médico precisava abrir os registros um a um.
- **Decisão:**
  - Nova rota `GET /patients/:id/cardiology-trends`. Ela devolve as fichas de cardiologia **assinadas**, da mais antiga para a mais recente, com a data clínica, o autor e um valor em texto por coluna: PA, FC, peso, IMC, NYHA, FEVE, LDL, HDL, TG, HbA1c, creatinina e NT-proBNP.
  - O acesso é o mesmo da linha do tempo, via `@crm/policy`: o pedido é auditado como leitura de `clinical_record`, e cada ficha passa pela mesma regra de leitura. Secretária e administrador recebem 403. O médico sem vínculo vê só as próprias fichas.
  - Ficha sensível de outro profissional fica de fora, mesmo que pudesse ser aberta com justificativa, e a resposta diz quantas ficaram (`withheld`). Para ver, o médico abre o registro na linha do tempo, com justificativa.
  - Rascunho, finalizado, retificado, arquivado e formulário genérico não entram. Com a retificação assinada, entra a nova versão e sai a original. Ficha sem nenhum dos valores acompanhados não vira linha.
  - Na tela, o painel **Evolução da cardiologia** aparece no prontuário só quando há alguma ficha assinada e mostra só as colunas com algum valor. Cada linha tem o botão **Abrir**, que abre o registro de origem.
- **Motivo:** Reaproveitar a regra da linha do tempo mantém uma única decisão de acesso. Mostrar só o assinado evita misturar valores que ainda podem mudar. Os valores vão como texto já formatado (por exemplo, "142/88", "26,3"), porque a tabela só exibe e não calcula nada.
- **Alternativas descartadas:**
  - Gráfico: precisa de biblioteca nova e de escolha de escalas que dependem de conferência clínica. A tabela vem primeiro.
  - Liberar a ficha sensível com uma justificativa para a tabela inteira: a justificativa é por registro ([ADR 0033](0033-busca-e-justificativa-no-corpo.md)).
  - Guardar os valores numa tabela própria para consulta: duplicaria o conteúdo assinado.
- **Consequências:** Só fichas criadas no formulário de cardiologia entram; números escritos no texto livre de registros genéricos não aparecem. O sistema não marca valores alterados nem metas.
- **Revisar quando:** O responsável pedir gráfico, metas (por exemplo, LDL-alvo) ou outras colunas, ou mudar a lista de campos da ficha.
