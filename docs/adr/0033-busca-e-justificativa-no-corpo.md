# ADR 0033: busca de paciente e justificativa de acesso no corpo do pedido

- **Status:** aceito (2026-11-02, item 5 da [revisão de segurança](../revisao/2026-11-01-revisao-de-seguranca.md))
- **Decisão 1 (busca):** `GET /patients?q=` deixa de existir. A busca passa a ser `POST /patients/search` com `{ q, includeInactive?, limit? }` no corpo (JSON, com tipos de verdade: `includeInactive` booleano e `limit` número). A regra de acesso continua a mesma: `view` em `patient`.
- **Decisão 2 (justificativa):** `GET /records/:id` não aceita mais nenhum parâmetro no endereço; com `?justification=` responde 400. Abrir um registro sensível de outro médico com justificativa passa a ser `POST /records/:id/open` com `{ justification }`. A justificativa continua sendo gravada e auditada como antes.
- **Motivo:** CPF, telefone e a justificativa (que pode citar o motivo clínico) iam no endereço. Endereços costumam ficar em registros de proxy, de balanceador e no histórico do navegador. No corpo, eles não vão para esses lugares.
- **Alternativas descartadas:** manter o `GET` e só exigir proxy sem registro da query string (depende de configurar certo cada hospedagem e não protege o histórico do navegador); aceitar os dois formatos por um tempo (não há clientes externos; o site muda junto).
- **Consequências:** `POST` exige o token CSRF, como as outras escritas; o site já manda. A busca não fica mais em cache de navegador, o que não muda nada porque a API já responde `no-store`. A exigência de proxy sem query string fica como reforço, não mais como proteção principal.
- **Revisar quando:** Surgir um cliente externo da API que precise de busca por `GET`.
