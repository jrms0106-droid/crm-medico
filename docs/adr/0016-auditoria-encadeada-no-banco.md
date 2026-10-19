# ADR 0016: Auditoria encadeada por hash, calculada pelo banco

- **Status:** aceito (2026-10-19, Etapa 7)
- **Decisão:**
  - Cada evento de auditoria guarda a posição na cadeia da organização (`chain_seq`), o resumo do evento anterior (`prev_hash`) e o próprio resumo (`hash`, SHA-256 de todos os campos).
  - O cálculo é feito por um gatilho `BEFORE INSERT` no PostgreSQL, com uma trava por organização (`pg_advisory_xact_lock`), e não pela API.
  - A verificação (`GET /audit/verify`) usa a mesma função do banco (`audit.event_digest`) para recalcular os resumos e aponta buracos, elos quebrados e conteúdo alterado.
  - A migração encadeia os eventos já existentes, na ordem de gravação.
- **Motivo:** Calculado no banco, o encadeamento vale para qualquer caminho de gravação e não depende de a API serializar os pedidos. Uma só função para gravar e verificar evita diferenças de formato (datas, campos vazios) entre duas implementações.
- **Alternativas descartadas:**
  - Calcular na API: exigiria serializar as gravações fora do banco e manter duas implementações do formato.
  - Uma cadeia única para todo o sistema: misturaria organizações e obrigaria a verificação a ler eventos de outras clínicas.
  - Serviço externo de trilha imutável ou registro em blockchain: custo e dependência sem necessidade no MVP.
- **Consequências:** As gravações de auditoria de uma organização passam a ser em fila. A verificação percorre a cadeia inteira; para volumes grandes, poderá verificar por período a partir de um ponto ancorado.
- **Riscos:** Quem tiver o papel dono das tabelas pode desligar os gatilhos e recalcular a cadeia toda. Mitigação pré-produção: separar os papéis do banco e guardar periodicamente o último resumo (`headHash`) fora do banco (ancoragem).
- **Revisar quando:** Houver ancoragem externa, separação de papéis ou se o volume de eventos tornar a verificação lenta.
