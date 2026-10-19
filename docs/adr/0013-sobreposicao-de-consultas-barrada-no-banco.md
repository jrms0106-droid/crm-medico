# ADR 0013: Sobreposição de consultas barrada no próprio banco

- **Status:** aceito (2026-10-19, Etapa 4)
- **Decisão:**
  - A tabela `scheduling.appointments` tem uma restrição `EXCLUDE USING gist` (extensão `btree_gist`) que recusa duas consultas ativas (`scheduled`, `confirmed`, `arrived`) da mesma agenda com períodos sobrepostos. Encaixes (`fit_in`) ficam de fora da restrição.
  - A API confere antes, para responder com uma mensagem clara, e traduz a recusa do banco (código 23P01) no mesmo 409 `SLOT_TAKEN`.
  - Para o mesmo paciente em agendas diferentes, a API usa uma trava transacional do PostgreSQL por paciente (`pg_advisory_xact_lock`) antes de conferir, para que duas marcações simultâneas do mesmo paciente não passem as duas.
  - Os horários de atendimento ficam em minutos da hora local da unidade; a conversão para UTC usa o banco de fusos do Node (`Intl`), sem biblioteca nova.
- **Motivo:** A checagem só na aplicação tem uma janela entre "conferir" e "gravar": duas secretárias marcando o mesmo horário no mesmo instante passariam as duas. A restrição no banco fecha essa janela, vale para qualquer caminho de gravação (scripts, importações futuras) e é testada com pedidos realmente simultâneos.
- **Alternativas descartadas:**
  - Bloquear a agenda inteira (`SELECT ... FOR UPDATE` ou nível de isolamento serializável) a cada marcação: funciona, mas serializa toda a agenda e exige repetir transações recusadas.
  - Dividir a agenda em horários fixos com índice único: não comporta durações diferentes nem mudança da duração padrão.
  - Biblioteca de datas (Luxon, date-fns-tz): o `Intl` do Node já resolve a conversão de fuso que precisamos.
- **Consequências:**
  - A extensão `btree_gist` precisa estar disponível no PostgreSQL da hospedagem (é extensão padrão do PostgreSQL).
  - Toda mudança de estado da consulta passa por `updateMany` condicionado ao estado de origem, para que duas pessoas não façam transições conflitantes.
- **Riscos:** Encaixes não têm proteção de sobreposição por desenho; o limite de encaixes por período, se a clínica quiser, fica para depois.
- **Revisar quando:** Houver agendas compartilhadas por vários profissionais (salas, equipamentos) ou feriados por calendário.
