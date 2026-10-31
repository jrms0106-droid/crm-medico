# Atendimento e vínculo assistencial

Regras definidas antes da implementação (seção 30 do Prompt Mestre). Atende às seções 5.2 e 5.3 de [03-arquitetura.md](../planejamento/03-arquitetura.md) e à Etapa 5 do plano.

> **Proposta para validação médica.** O que cada estado libera, o período de cortesia (30 dias) e a duração do acesso emergencial (4 horas) são propostas técnicas iniciais. Precisam ser validados por médicos e pelo jurídico antes de qualquer uso real. Os dois prazos são configuráveis (`CARE_COURTESY_DAYS` e `EMERGENCY_ACCESS_HOURS`).

## Conceitos

- **Atendimento** (`care.encounters`): começa quando o médico inicia a consulta de um paciente que já chegou à recepção, e termina quando o médico o encerra. Ao encerrar, o médico pode indicar um **acompanhamento ativo** de 1 a 365 dias.
- **Vínculo assistencial:** a relação entre um médico e um paciente, que decide o que o médico pode ver e fazer no prontuário. Ele **não é gravado**. É calculado a cada pedido a partir das consultas e dos atendimentos, para nunca ficar desatualizado.
- **Acesso emergencial** ("quebra de vidro", `care.emergency_accesses`): leitura temporária do prontuário sem vínculo, com justificativa, que vai para uma fila de revisão.

## Estados do vínculo

O estado vale para um médico e um paciente. Quando mais de um se aplica, vale o primeiro da lista.

| Estado                             | Quando                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `started` (atendimento iniciado)   | O médico tem um atendimento aberto com o paciente                                         |
| `follow_up` (acompanhamento ativo) | Um atendimento encerrado com acompanhamento ainda dentro do prazo                         |
| `closed` (encerrado, em cortesia)  | Um atendimento encerrado há menos de 30 dias                                              |
| `confirmed` (confirmado)           | Consulta com o médico confirmada ou com o paciente já na recepção, de ontem para a frente |
| `scheduled` (agendado)             | Consulta com o médico agendada, de ontem para a frente                                    |
| `expired` (expirado)               | Já houve atendimento, mas os prazos acima acabaram                                        |
| sem vínculo                        | Nenhum dos anteriores                                                                     |

## O que cada estado libera

Recursos clínicos: `clinical_summary` (resumo de segurança: motivo da consulta, alergias e problemas ativos), `clinical_record` (registros do prontuário), `medical_document` (documentos médicos, ver [documentos.md](documentos.md)) e `encounter` (atendimento).

| Estado      | Resumo de segurança | Registros do prontuário                                                                | Atendimento                          |
| ----------- | ------------------- | -------------------------------------------------------------------------------------- | ------------------------------------ |
| `scheduled` | ver                 | —                                                                                      | iniciar (consulta da própria agenda) |
| `confirmed` | ver                 | —                                                                                      | iniciar (consulta da própria agenda) |
| `started`   | ver                 | ver histórico, criar, editar, adendar e assinar                                        | ver, encerrar                        |
| `follow_up` | ver                 | ver histórico, criar, editar, adendar e assinar                                        | ver                                  |
| `closed`    | ver                 | ver histórico, terminar e assinar os próprios, adendar os próprios. **Não cria novos** | ver                                  |
| `expired`   | —                   | só os de sua autoria: ver e adendar                                                    | —                                    |
| sem vínculo | —                   | —                                                                                      | —                                    |
| emergencial | ver                 | ver (só leitura)                                                                       | —                                    |

Regras que valem em todos os estados:

1. **Agendamento não libera o histórico.** Antes de iniciar o atendimento, o médico vê só o resumo de segurança.
2. **Autoria:** editar, adendar e assinar só os próprios registros. Os registros de sua autoria o médico sempre pode ver e adendar, mesmo com o vínculo expirado (obrigação documental).
3. **Sensibilidade:** registros de outros autores com sensibilidade `elevated` (por exemplo, saúde mental) ou `restricted` (marcado pelo autor) exigem justificativa registrada, mesmo com vínculo em andamento. Sem justificativa, a resposta é negar (`justification_required`). O acesso emergencial já é uma justificativa.
4. **Só médico.** Secretária e administrador nunca acessam dado clínico. O administrador que também é médico acessa pelo papel de médico.
5. Compartilhar continua negado para todos. Exportar só vale para o PDF de documento médico e para a cópia do prontuário pedida pelo paciente (`export` de `clinical_record`, em `started`, `follow_up` e `closed`, ver [direitos-do-titular.md](direitos-do-titular.md)); nunca no acesso emergencial.

As regras ficam no motor de política, testadas estado por estado, e valem para os registros do prontuário ([prontuario.md](prontuario.md)). A rota `GET /patients/:id/care-access` mostra ao médico o que ele pode fazer com cada paciente.

## Atendimento

- **Iniciar:** só o médico dono da agenda, com a consulta no estado `arrived` (o paciente chegou). Uma consulta tem no máximo um atendimento. O médico não pode ter dois atendimentos abertos com o mesmo paciente.
- **Encerrar:** só o médico do atendimento. `followUpDays` (opcional, 1 a 365) abre o acompanhamento ativo.
- Iniciar e encerrar são auditados com o paciente.

## Acesso emergencial

- Só médico. Exige **reautenticação recente** e justificativa escrita (20 a 1.000 caracteres).
- Libera leitura do resumo e do prontuário daquele paciente por 4 horas, e **expira sozinho**, sem tarefa agendada: cada pedido confere o prazo.
- Não libera criar, editar, assinar, exportar nem compartilhar.
- Toda concessão entra na **fila de revisão**, que o administrador vê e encerra como `appropriate` (adequado) ou `inappropriate` (inadequado), com observação. A revisão fica registrada e não pode ser refeita.
- O administrador vê quem pediu, quando, o identificador do paciente e a justificativa, mas não vê o prontuário.
- Todo uso aparece na auditoria com o motivo `emergency_access`.
- O aviso imediato ao administrador e ao responsável de conformidade (e-mail ou mensagem) depende do módulo de notificações, fora do MVP. Até lá, o aviso é a fila de revisão.

## Permissões das rotas novas

| Recurso            | Médico                            | Secretária | Administrador |
| ------------------ | --------------------------------- | ---------- | ------------- |
| `encounter`        | conforme o vínculo (tabela acima) | —          | —             |
| `clinical_summary` | conforme o vínculo                | —          | —             |
| `emergency_access` | pedir (com reautenticação)        | —          | —             |
| `emergency_review` | —                                 | —          | ver e revisar |

## Endpoints (`/api/v1`, sessão `active`)

| Método e rota                         | Permissão                                  | Corpo / parâmetros                       | Resposta                                                                                    |
| ------------------------------------- | ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /appointments/:id/encounter`    | `encounter` create                         | —                                        | 201 `Encounter`; 409 se a consulta não está `arrived` ou já tem atendimento                 |
| `GET /encounters/:id`                 | `encounter` view                           | —                                        | 200 `Encounter`                                                                             |
| `POST /encounters/:id/close`          | `encounter` edit                           | `{ followUpDays? }`                      | 200 `Encounter`; 403 se já encerrado (o vínculo encerrado não permite mexer no atendimento) |
| `GET /patients/:id/care-access`       | `patient_registration` view                | —                                        | 200 `CareAccess`                                                                            |
| `POST /patients/:id/emergency-access` | `emergency_access` create + reautenticação | `{ justification }`                      | 201 `EmergencyAccess`                                                                       |
| `GET /emergency-access/reviews`       | `emergency_review` view                    | `status?` (`pending` padrão, `reviewed`) | 200 `EmergencyAccess[]`                                                                     |
| `POST /emergency-access/:id/review`   | `emergency_review` edit                    | `{ outcome, notes }`                     | 200 `EmergencyAccess`; 409 se já revisado                                                   |

- `Encounter` = `{ id, appointmentId, patientId, doctorUserId, unitId, status ('started' \| 'closed'), startedAt, closedAt, followUpUntil }`
- `CareAccess` = `{ state, emergencyUntil, can: { viewSummary, viewHistory, createRecords, viewOwnRecords, viewSensitiveOfOthers } }`, onde `viewSensitiveOfOthers` é `allowed`, `justification_required` ou `denied`. Para o médico, `viewOwnRecords` é sempre verdadeiro (regra 2). Para a secretária, todos os itens vêm negados; o administrador recebe 403, porque não acessa o cadastro de pacientes.
- `EmergencyAccess` = `{ id, patientId, requestedBy: { id, name }, justification, startsAt, expiresAt, active, review: { outcome, notes, reviewedAt, reviewedBy } | null }`

## Fora desta etapa

Notificação imediata do acesso emergencial (módulo de mensagens), regras de sensibilidade por especialidade (validação médica), telas (Etapa 7).
