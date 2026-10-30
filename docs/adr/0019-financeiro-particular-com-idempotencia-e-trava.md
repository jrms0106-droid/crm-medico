# ADR 0019: Financeiro particular com valores em centavos, idempotência gravada e trava da cobrança

- **Status:** aceito (2026-10-30, financeiro particular)
- **Decisão:**
  - O financeiro desta fase atende só o particular, como o responsável escolheu: tabela de preços, cobrança por atendimento ou avulsa, pagamentos recebidos na recepção e relatório por período. Sem convênios, sem integração de pagamento e sem emissão fiscal.
  - Valores em centavos, como inteiros, com faixas conferidas no banco. A situação da cobrança (em aberto, pago em parte, quitada, cancelada) é calculada a partir dos pagamentos, e não gravada.
  - Valor e desconto da cobrança e os dados do pagamento não mudam depois de gravados (gatilhos no banco). A correção é por cancelamento da cobrança ou por estorno do pagamento, com motivo; o estorno é do administrador, com reautenticação.
  - Registrar pagamento exige o cabeçalho `Idempotency-Key`. A chave e o resumo SHA-256 do pedido ficam gravados no próprio pagamento, com unicidade por organização: a repetição devolve o mesmo resultado, e a mesma chave com outros dados é recusada.
  - Durante o registro, a cobrança fica travada (`SELECT … FOR UPDATE`), para dois pagamentos simultâneos não passarem do saldo.
- **Motivo:** Inteiros evitam erro de arredondamento. Calcular a situação evita que ela divirja dos pagamentos. Gravar a chave junto do pagamento, na mesma transação, garante que não exista pagamento sem chave nem chave sem pagamento, sem precisar de uma tabela genérica de idempotência.
- **Alternativas descartadas:**
  - Tabela genérica de idempotência para todas as rotas: só esta rota precisa agora; volta a ser avaliada quando houver cobrança on-line ou envio de mensagens.
  - Situação gravada na cobrança: mais um campo para manter em sincronia.
  - Permitir editar valor ou pagamento: perde-se o rastro do que foi cobrado e recebido.
- **Consequências:** Relatórios somam no servidor a partir das linhas, o que basta para o volume de uma clínica. Se crescer, entram consultas agregadas no banco.
- **Revisar quando:** Entrarem convênios, gateway de pagamento, Pix dinâmico, recibo ou nota fiscal.
