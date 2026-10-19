# Agenda

Regras definidas antes da implementação (seção 30 do Prompt Mestre). Atende à seção 7 do Prompt Mestre e à Etapa 4 do plano.

## Conceitos

- **Agenda:** uma por profissional em cada unidade (`scheduling.schedules`). Tem a duração padrão da consulta (5 a 240 minutos, padrão 30) e pode ser desativada.
- **Horário de atendimento:** faixas por dia da semana, em hora local da unidade (por exemplo, segunda das 08:00 às 12:00 e das 14:00 às 18:00). As faixas de um mesmo dia não podem se sobrepor.
- **Bloqueio:** período em que a agenda não aceita consultas (férias, congresso, reunião), com motivo. Um bloqueio não pode cobrir consultas já marcadas: é preciso reagendá-las ou cancelá-las antes. Um bloqueio removido continua no histórico.
- **Consulta (agendamento):** paciente, agenda, início, fim e tipo:
  - `regular`: ocupa o horário com exclusividade;
  - `return` (retorno): também ocupa com exclusividade e aponta a consulta de origem do mesmo paciente;
  - `fit_in` (encaixe): pode ficar sobre outro horário ocupado, por decisão da secretária. Ainda assim precisa estar dentro do horário de atendimento e fora de bloqueios.
- **Lista de espera:** paciente aguardando vaga numa unidade, com profissional opcional e preferência de horário em texto curto. Quando a vaga aparece, a consulta é criada a partir da entrada, que passa a "agendado".

O motivo clínico da consulta **não** fica na agenda. O campo `notes` serve só a observações administrativas curtas (até 200 caracteres), como "trazer exames anteriores". O motivo clínico entra no atendimento (Etapa 5).

## Estados da consulta

| Estado                                      | Ocupa o horário | Pode ir para                                                  |
| ------------------------------------------- | --------------- | ------------------------------------------------------------- |
| `scheduled` (agendada)                      | sim             | `confirmed`, `arrived`, `cancelled`, `no_show`, `rescheduled` |
| `confirmed` (confirmada)                    | sim             | `arrived`, `cancelled`, `no_show`, `rescheduled`              |
| `arrived` (presença confirmada na recepção) | sim             | — (o atendimento começa na Etapa 5)                           |
| `cancelled` (cancelada)                     | não             | —                                                             |
| `no_show` (falta)                           | não             | —                                                             |
| `rescheduled` (reagendada)                  | não             | — (aponta a nova consulta)                                    |

- Falta só pode ser marcada depois do horário de início.
- Presença pode ser marcada a partir de 2 horas antes do início.
- Cancelamento exige motivo e quem pediu (`patient` ou `clinic`).
- **Reagendar** cria uma consulta nova, ligada à antiga. A antiga fica como `rescheduled`, com o novo horário apontado. Nada se perde: as duas e os eventos de cada uma continuam consultáveis.
- Toda mudança de estado gera um **evento** (`scheduling.appointment_events`), somente-acréscimo, com quem, quando e o quê.

## Regras ao marcar

1. A agenda precisa estar ativa, e o paciente ativo e da mesma organização.
2. O início não pode estar no passado e precisa ser múltiplo de 5 minutos. A duração é a padrão da agenda ou outra entre 5 e 240 minutos, múltipla de 5.
3. A consulta inteira precisa caber numa faixa do horário de atendimento daquele dia (422 `OUTSIDE_WORKING_HOURS`).
4. Não pode tocar um bloqueio ativo (422 `SLOT_BLOCKED`).
5. Consultas `regular` e `return` não podem se sobrepor a outra consulta ativa da mesma agenda (409 `SLOT_TAKEN`). **O próprio banco impede**: uma restrição `EXCLUDE USING gist` recusa a sobreposição mesmo com duas requisições exatamente simultâneas.
6. O mesmo paciente não pode ter duas consultas ativas sobrepostas, em qualquer agenda (409 `PATIENT_DOUBLE_BOOKED`).
7. O retorno precisa apontar uma consulta anterior do mesmo paciente.

## Disponibilidade

`GET /schedules/:id/availability?date=AAAA-MM-DD` devolve os horários livres do dia na duração padrão. São as faixas de atendimento menos os bloqueios, as consultas ativas que não são encaixe e os horários que já passaram.

## Permissões

O recurso `schedule` é a configuração da agenda (faixas, duração e bloqueios). O recurso `appointment` são as consultas e a lista de espera, que contêm o nome do paciente. Os dois são operacionais e exigem que o usuário pertença à unidade da agenda.

| Papel         | `schedule`                | `appointment`                                |
| ------------- | ------------------------- | -------------------------------------------- |
| Secretária    | visualizar, criar, editar | visualizar, criar, editar                    |
| Médico        | visualizar                | visualizar **só a própria agenda**           |
| Administrador | visualizar, criar, editar | — (configura a agenda, mas não vê pacientes) |

Toda decisão é auditada, com a unidade e, quando houver, o paciente.

## Endpoints (`/api/v1`, sessão `active`)

| Método e rota                                | Permissão            | Corpo / parâmetros                                                                                    | Resposta                                                           |
| -------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /units/:unitId/schedules`               | `schedule` view      | —                                                                                                     | 200 `Schedule[]`                                                   |
| `POST /units/:unitId/schedules`              | `schedule` create    | `{ professionalId, slotMinutes? }`                                                                    | 201 `Schedule`; 409 se já existe; 422 profissional fora da unidade |
| `PATCH /schedules/:id`                       | `schedule` edit      | `{ slotMinutes?, active? }`                                                                           | 200 `Schedule`                                                     |
| `PUT /schedules/:id/rules`                   | `schedule` edit      | `[{ weekday (0=domingo), start "HH:MM", end "HH:MM" }]`                                               | 200 `Schedule`                                                     |
| `POST /schedules/:id/blocks`                 | `schedule` edit      | `{ startsAt, endsAt, reason }`                                                                        | 201 `Block`; 409 `BLOCK_HAS_APPOINTMENTS`                          |
| `POST /schedules/:id/blocks/:blockId/remove` | `schedule` edit      | —                                                                                                     | 204                                                                |
| `GET /schedules/:id/availability`            | `schedule` view      | `date`                                                                                                | 200 `{ startsAt, endsAt }[]`                                       |
| `GET /schedules/:id/appointments`            | `appointment` view   | `from`, `to` (até 31 dias)                                                                            | 200 `Appointment[]`                                                |
| `POST /appointments`                         | `appointment` create | `{ scheduleId, patientId, startsAt, durationMinutes?, kind?, returnOfId?, notes?, waitlistEntryId? }` | 201 `Appointment`                                                  |
| `GET /appointments/:id`                      | `appointment` view   | —                                                                                                     | 200 `Appointment`                                                  |
| `GET /appointments/:id/history`              | `appointment` view   | —                                                                                                     | 200 `AppointmentEvent[]`                                           |
| `POST /appointments/:id/confirm`             | `appointment` edit   | —                                                                                                     | 200                                                                |
| `POST /appointments/:id/check-in`            | `appointment` edit   | —                                                                                                     | 200                                                                |
| `POST /appointments/:id/no-show`             | `appointment` edit   | —                                                                                                     | 200                                                                |
| `POST /appointments/:id/cancel`              | `appointment` edit   | `{ reason, requestedBy }`                                                                             | 200                                                                |
| `POST /appointments/:id/reschedule`          | `appointment` edit   | `{ startsAt, scheduleId?, durationMinutes? }`                                                         | 201 nova `Appointment`                                             |
| `GET /units/:unitId/waitlist`                | `appointment` view   | —                                                                                                     | 200 `WaitlistEntry[]` (só as que aguardam)                         |
| `POST /units/:unitId/waitlist`               | `appointment` create | `{ patientId, professionalId?, preference? }`                                                         | 201                                                                |
| `POST /waitlist/:id/remove`                  | `appointment` edit   | `{ reason }`                                                                                          | 204                                                                |

- Horários de entrada e saída em ISO 8601 com fuso (`2026-03-10T09:00:00-03:00`); as respostas vêm em UTC.
- Transição de estado inválida devolve 409 `INVALID_STATE_TRANSITION`.

## Fora desta etapa

Atendimento e vínculo assistencial (Etapa 5), lembretes e confirmação por mensagem (fase de CRM), cobrança da consulta (fase financeira), telas (Etapa 7), feriados por calendário.
