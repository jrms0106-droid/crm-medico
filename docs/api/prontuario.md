# Prontuário básico

Regras definidas antes da implementação (seção 30 do Prompt Mestre). Atende à seção 6 de [03-arquitetura.md](../planejamento/03-arquitetura.md) e à Etapa 6 do plano.

> **Formulário genérico, a validar.** Os campos (motivo, anamnese, exame físico, hipóteses com CID-10, conduta) são o formulário genérico do plano, até os médicos validarem os campos por especialidade. A assinatura aqui é a **assinatura eletrônica interna** (reautenticação). Ela não é assinatura ICP-Brasil, e o nível exigido para cada tipo de registro depende de **validação jurídica** (Res. CFM 1.821/2007, Lei 14.063/2020). Não declaramos conformidade sem essa validação.

## Registro clínico

Cada registro (`records.clinical_records`) guarda:

- paciente, autor e atendimento de origem (quando houver um aberto), unidade do atendimento;
- tipo: `consultation` (consulta), `evolution` (evolução) ou `addendum` (adendo);
- data clínica, sensibilidade, versão, estado e versão do formulário (`generic-v1`);
- o conteúdo e, depois da assinatura, o resumo SHA-256 e as evidências da assinatura.

Conteúdo do formulário genérico, todos os campos opcionais, cada um com até 20.000 caracteres:

| Campo            | O que é                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `chiefComplaint` | Motivo da consulta                                                                                         |
| `anamnesis`      | Anamnese                                                                                                   |
| `physicalExam`   | Exame físico                                                                                               |
| `hypotheses`     | Até 20 hipóteses, cada uma com descrição e CID-10 opcional (só o formato é conferido, por exemplo `J06.9`) |
| `plan`           | Conduta                                                                                                    |

## Estados

| Estado      | Quem vê                                | Pode ir para                                              |
| ----------- | -------------------------------------- | --------------------------------------------------------- |
| `draft`     | só o autor                             | `finalized`; ou `discarded`, se nunca foi finalizado      |
| `finalized` | quem tem acesso ao histórico           | `signed`; ou `draft`, com motivo registrado               |
| `signed`    | quem tem acesso ao histórico           | `rectified` (quando a retificação é assinada), `archived` |
| `rectified` | quem tem acesso ao histórico           | `archived`                                                |
| `archived`  | quem tem acesso, pedindo os arquivados | —                                                         |
| `discarded` | só o autor                             | —                                                         |

- **Nada é apagado.** O banco recusa `DELETE` em registros, versões e eventos.
- **Salvamento automático:** cada gravação do rascunho cria uma versão nova (`records.record_versions`), com quem salvou e quando. As versões não podem ser alteradas nem apagadas.
- **Conflito de edição:** a gravação exige a `version` que a pessoa estava editando. Se outra gravação veio antes, a resposta é 409 `VERSION_CONFLICT`, nada é gravado, e o texto enviado não se perde: a tela continua com ele e pode buscar a versão atual para comparar.
- Toda mudança de estado gera um evento somente-acréscimo (`records.record_events`), com quem, quando e o motivo, quando houver.

## Assinatura

- Só o autor assina, só um registro `finalized`, e só com **reautenticação recente** (403 `REAUTH_REQUIRED`).
- Ao assinar, a API calcula o SHA-256 do conteúdo canônico (identificador, paciente, autor, tipo, data clínica, sensibilidade, versão do formulário, vínculos e conteúdo, com as chaves em ordem) e grava o resumo com as evidências: sessão, momento da reautenticação, IP e identificador da requisição.
- **Depois de assinado, o conteúdo fica congelado no banco.** Um gatilho recusa qualquer `UPDATE` no conteúdo, no resumo, nas evidências, na sensibilidade, no autor ou no paciente, venha da API ou de SQL direto com o usuário da aplicação. Só a mudança de estado para `rectified` ou `archived` é aceita.
- `GET /records/:id` recalcula o resumo e informa `integrity: "valid"` ou `"invalid"`.
- Limite conhecido: o usuário da aplicação ainda é dono das tabelas e, em tese, poderia desligar o gatilho. Separar o papel que roda as migrações do papel que a API usa está na lista do que fazer antes de produção.

## Retificação e adendo

- **Retificação** substitui um registro assinado. Cria um rascunho novo que aponta o original (`rectifiesId`), com justificativa obrigatória (10 a 1.000 caracteres). Quando a retificação é assinada, o original passa a `rectified` e aponta a retificação (`rectifiedById`). Os dois continuam visíveis.
- **Adendo** complementa um registro assinado ou retificado, sem substituí-lo. Cria um rascunho do tipo `addendum` que aponta o original (`addendumOfId`), também com justificativa, e também precisa ser assinado.
- Só o autor do original retifica ou adenda, inclusive com o vínculo expirado (obrigação documental, ver [atendimento-e-vinculo.md](atendimento-e-vinculo.md)).
- Um registro tem no máximo uma retificação em andamento ou assinada.
- Todo o trabalho sobre o rascunho de uma retificação ou de um adendo (salvar, finalizar, assinar) conta como a ação `correct` na política. Assim o autor consegue terminar o adendo mesmo com o vínculo expirado, sem ganhar acesso a registros de outros.

## Sensibilidade

`normal`, `elevated` (por exemplo, saúde mental) ou `restricted` (marcada pelo autor). O autor escolhe ao criar e pode mudar enquanto for rascunho.

Registros `elevated` ou `restricted` de outros autores aparecem na linha do tempo sem o conteúdo. Para abrir, o médico envia uma justificativa (10 a 1.000 caracteres), que fica gravada (`records.access_justifications`) e na auditoria. Quais especialidades e tipos de registro entram em cada nível é decisão clínica a validar.

## Quem pode o quê

Tudo segue o vínculo assistencial ([atendimento-e-vinculo.md](atendimento-e-vinculo.md)): criar registro só com atendimento iniciado ou acompanhamento ativo; ver o histórico só nesses estados e no período de cortesia; editar, assinar, retificar e adendar só os próprios registros. Secretária e administrador nunca acessam. Registros de rascunho e descartados de outros autores respondem 404.

## Linha do tempo

`GET /patients/:id/records` lista os registros visíveis ao médico, do mais recente para o mais antigo pela data clínica:

- sem os rascunhos e descartados de outros autores;
- sem os arquivados, a menos que se peça `includeArchived=true`;
- os sensíveis de outros autores vêm sem conteúdo, com `contentHidden: true`;
- com o vínculo expirado, só os registros do próprio médico.

A consulta à linha do tempo é auditada uma vez, com o paciente.

## Endpoints (`/api/v1`, sessão `active`)

| Método e rota                | Ação (`clinical_record`) | Corpo / parâmetros                                     | Resposta                                                           |
| ---------------------------- | ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `POST /patients/:id/records` | create                   | `{ kind?, clinicalDate?, sensitivity?, content? }`     | 201 `Record` (rascunho)                                            |
| `GET /patients/:id/records`  | view                     | `includeArchived?`                                     | 200 `RecordSummary[]`                                              |
| `GET /records/:id`           | view                     | — (nada no endereço; com `?justification=` dá 400)     | 200 `Record`; 403 `justification_required`                         |
| `POST /records/:id/open`     | view com justificativa   | `{ justification }` (registro sensível de outro autor) | 200 `Record`; justificativa gravada e auditada                     |
| `GET /records/:id/versions`  | view (só o autor)        | —                                                      | 200 versões salvas                                                 |
| `GET /records/:id/history`   | view                     | —                                                      | 200 eventos                                                        |
| `PATCH /records/:id`         | edit                     | `{ version, content?, clinicalDate?, sensitivity? }`   | 200 `Record`; 409 `VERSION_CONFLICT` ou `INVALID_STATE_TRANSITION` |
| `POST /records/:id/finalize` | edit                     | `{ version }`                                          | 200; 422 se o conteúdo estiver vazio                               |
| `POST /records/:id/reopen`   | edit                     | `{ reason }`                                           | 200 (volta a rascunho)                                             |
| `POST /records/:id/discard`  | edit                     | —                                                      | 200                                                                |
| `POST /records/:id/sign`     | sign + reautenticação    | `{ version }`                                          | 200                                                                |
| `POST /records/:id/rectify`  | correct                  | `{ justification, content? }`                          | 201 `Record` (rascunho da retificação)                             |
| `POST /records/:id/addendum` | correct                  | `{ justification, content? }`                          | 201 `Record` (rascunho do adendo)                                  |
| `POST /records/:id/archive`  | edit                     | —                                                      | 200                                                                |

Transição de estado inválida: 409 `INVALID_STATE_TRANSITION`.

## Fora desta etapa

Formulários por especialidade (validação médica), resumo de segurança com alergias e problemas ativos, anexos, documentos e assinatura ICP-Brasil (fase de documentos), auditoria encadeada por hash e telas (Etapa 7).
