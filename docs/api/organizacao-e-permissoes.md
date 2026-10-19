# Organização, perfis e permissões

Regras definidas antes da implementação (seção 30 do Prompt Mestre). Etapa 2 do plano.

## Entidades

- **Unidade** (`org.units`): já existia. Agora os usuários são ligados a uma ou mais unidades por **vínculo de unidade** (`org.unit_memberships`).
- **Especialidade** (`org.specialties`): catálogo da organização (nome único, ativa/inativa).
- **Profissional** (`org.professionals`): ficha profissional de um usuário com papel de médico. Guarda o número do CRM e a UF, que juntos são únicos na organização. Cada especialidade da ficha pode ter um RQE (`org.professional_specialties`).
- **Evento de auditoria** (`audit.events`): toda decisão de acesso, permitida ou negada, e toda busca por identificador que não existe no alcance do usuário. A tabela só aceita inclusão: um gatilho no banco recusa `UPDATE` e `DELETE`. O encadeamento por hash e o painel ficam para a Etapa 7.

## Como a decisão é tomada

O motor `@crm/policy` recebe quem pede (usuário, papéis, organização, unidades), a ação, o recurso (tipo, classe de dado, organização, unidade) e o contexto (vínculo assistencial, a partir da Etapa 5). Ele devolve permitir ou negar, sempre com um motivo, que vai para a auditoria.

1. **Negação explícita vence**, nesta ordem:
   - recurso de outra organização: `other_organization`
   - dado clínico pedido por quem não é médico: `clinical_requires_doctor` (o administrador **nunca** tem acesso clínico pelo papel de administrador)
   - dado clínico sem vínculo assistencial em andamento: `no_care_relationship`
   - recurso operacional de uma unidade à qual o usuário não pertence: `other_unit`
2. Depois, a **matriz de papéis** abaixo concede a ação.
3. Sem concessão, a resposta é **negar** (`default_deny`). Um erro dentro de uma regra também nega (`rule_error`).

Um usuário com dois papéis (por exemplo, administrador e médico) soma as concessões dos dois.

## Matriz papel × recurso × ação

Ações: visualizar (`view`), criar (`create`), editar (`edit`), corrigir (`correct`), assinar (`sign`), exportar (`export`), compartilhar (`share`).

| Recurso                                  | Classe         | Médico                                                     | Secretária                | Administrador             | Escopo de unidade      |
| ---------------------------------------- | -------------- | ---------------------------------------------------------- | ------------------------- | ------------------------- | ---------------------- |
| `unit` (unidade)                         | administrativo | visualizar                                                 | visualizar                | visualizar, criar, editar | sim, exceto admin      |
| `user_account` (contas e acessos)        | administrativo | —                                                          | —                         | visualizar, criar, editar | não                    |
| `specialty` (especialidade)              | administrativo | visualizar                                                 | visualizar                | visualizar, criar, editar | não                    |
| `professional` (ficha profissional)      | administrativo | visualizar                                                 | visualizar                | visualizar, criar, editar | não                    |
| `unit_professionals` (equipe da unidade) | administrativo | visualizar                                                 | visualizar                | visualizar                | sim, todos os papéis   |
| `patient_registration` (cadastro)        | pessoal        | visualizar, criar, editar                                  | visualizar, criar, editar | —                         | não                    |
| `schedule` (configuração da agenda)      | administrativo | visualizar                                                 | visualizar, criar, editar | visualizar, criar, editar | sim, todos os papéis   |
| `appointment` (consultas e espera)       | pessoal        | visualizar, só da própria agenda                           | visualizar, criar, editar | —                         | sim, todos os papéis   |
| `clinical_record` (prontuário)           | clínico        | visualizar, criar, editar, corrigir, assinar (com vínculo) | —                         | —                         | não (é da organização) |
| `audit_event` (auditoria)                | auditoria      | —                                                          | —                         | visualizar                | não                    |

- **Exportar e compartilhar** não estão liberados para ninguém no MVP. Entram com a reautenticação e a auditoria reforçada, depois da validação jurídica.
- **Agenda (Etapa 4):** a configuração (`schedule`) é separada das consultas (`appointment`), porque o administrador configura agendas, mas não vê pacientes. Ver [agenda.md](agenda.md).
- **Cadastro, agenda e prontuário** entraram na matriz antes para que as Etapas 3, 4 e 6 já nasçam com a regra testada. As rotas desses recursos ainda não existem.
- **Vínculo assistencial:** nesta etapa, o médico só tem acesso clínico com um vínculo nos estados "atendimento iniciado" ou "acompanhamento ativo". A tabela completa por estado (seção 5.2 de [03-arquitetura.md](../planejamento/03-arquitetura.md)) chega na Etapa 5 e **precisa de validação médica**.
- O prontuário é do paciente na organização, não da unidade, por isso não tem escopo de unidade (seção 9 da arquitetura).

## Regras de negócio

- Só o administrador gerencia contas, unidades, especialidades e fichas profissionais, e só dentro da própria organização.
- Criar uma conta, mudar papéis ou unidades de alguém, redefinir acesso, desativar e reativar exigem **reautenticação recente** (5 minutos), por serem alterações de permissão (403 `REAUTH_REQUIRED`).
- Mudar papéis ou unidades derruba as sessões abertas da pessoa, para que ela entre de novo já com as permissões novas.
- O administrador não pode tirar o próprio papel de administrador, nem desativar ou redefinir o próprio acesso (422). Isso evita que a clínica fique sem administrador por engano.
- Toda conta precisa de ao menos um papel e ao menos uma unidade.
- Uma conta nova recebe uma senha temporária, mostrada uma única vez, e precisa trocá-la no primeiro acesso.
- Ficha profissional só para quem tem o papel de médico. Uma ficha por pessoa. CRM com 1 a 10 dígitos e UF válida; o par CRM + UF não se repete na organização (409). RQE, quando houver, tem 1 a 10 dígitos.
- Especialidade inativa não pode ser adicionada a uma ficha.
- Nada é apagado: unidades, especialidades, fichas e contas são desativadas.

## Identificadores manipulados

- Identificador malformado na URL: 400 `VALIDATION_FAILED`.
- Identificador bem formado que não existe, ou que pertence a outra organização: 404 `NOT_FOUND`, **com evento de auditoria** (`not_found`). A resposta é a mesma nos dois casos, para não revelar o que existe fora do alcance do usuário.
- Recurso da mesma organização, mas de unidade alheia: 403 `FORBIDDEN`, com evento de auditoria (`other_unit`).

## Auditoria

Cada evento registra: data e hora, organização, usuário, sessão, identificador da requisição, IP, ação, tipo e identificador do recurso, unidade, paciente (quando houver), resultado (`allowed`, `denied`, `not_found`) e motivo da política. **Não** registra o conteúdo dos dados.

Se a gravação do evento falhar, a operação não acontece (500), para que nenhum acesso fique sem registro.

## Endpoints (`/api/v1`, todos exigem sessão `active`)

| Método e rota                        | Permissão                                                  | Corpo                                                           | Resposta                                           |
| ------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| `GET /units`                         | `unit` view                                                | —                                                               | 200 `Unit[]` (admin vê todas; os demais, as suas)  |
| `POST /units`                        | `unit` create                                              | `{ name, timezone? }`                                           | 201 `Unit`; 409 nome repetido                      |
| `PATCH /units/:id`                   | `unit` edit                                                | `{ name?, timezone?, active? }`                                 | 200 `Unit`                                         |
| `GET /units/:id/professionals`       | `unit_professionals` view                                  | —                                                               | 200 `Professional[]` da unidade                    |
| `GET /specialties`                   | `specialty` view                                           | —                                                               | 200 `Specialty[]`                                  |
| `POST /specialties`                  | `specialty` create                                         | `{ name }`                                                      | 201 `Specialty`; 409                               |
| `PATCH /specialties/:id`             | `specialty` edit                                           | `{ name?, active? }`                                            | 200 `Specialty`                                    |
| `GET /professionals`                 | `professional` view                                        | —                                                               | 200 `Professional[]`                               |
| `GET /professionals/:id`             | `professional` view                                        | —                                                               | 200 `Professional`                                 |
| `POST /professionals`                | `professional` create                                      | `{ userId, crmNumber, crmState, specialties }`                  | 201 `Professional`; 409; 422                       |
| `PATCH /professionals/:id`           | `professional` edit                                        | `{ crmNumber?, crmState?, specialties?, active? }`              | 200 `Professional`                                 |
| `GET /admin/users`                   | `user_account` view                                        | —                                                               | 200 `UserAccount[]`                                |
| `GET /admin/users/:id`               | `user_account` view                                        | —                                                               | 200 `UserAccount`                                  |
| `POST /admin/users`                  | `user_account` create + reauth                             | `{ name, email, roles, unitIds }`                               | 201 `{ user, temporaryPassword }`; 409             |
| `PATCH /admin/users/:id`             | `user_account` edit (+ reauth se mudar papéis ou unidades) | `{ name?, roles?, unitIds? }`                                   | 200 `UserAccount`; 422                             |
| `POST /admin/users/:id/reset-access` | `user_account` edit + reauth                               | —                                                               | 200 `{ temporaryPassword }`                        |
| `POST /admin/users/:id/deactivate`   | `user_account` edit + reauth                               | —                                                               | 204                                                |
| `POST /admin/users/:id/reactivate`   | `user_account` edit + reauth                               | —                                                               | 204                                                |
| `GET /audit/events`                  | `audit_event` view                                         | query `outcome?`, `actorUserId?`, `limit?` (até 200), `before?` | 200 `AuditEvent[]`, do mais recente ao mais antigo |

- `specialties` em `POST/PATCH /professionals` é uma lista `[{ specialtyId, rqe? }]` que substitui a anterior.
- `Professional` = `{ id, userId, name, crmNumber, crmState, active, specialties: [{ id, name, rqe }] }`.
- `UserAccount` = `{ id, name, email, roles, unitIds, active, mfaEnabled, mustChangePassword, professionalId }`.

## Fora desta etapa

Painel de auditoria e encadeamento por hash (Etapa 7); estados completos do vínculo assistencial e acesso emergencial (Etapa 5); telas de administração (Etapa 7); exportação e compartilhamento.
