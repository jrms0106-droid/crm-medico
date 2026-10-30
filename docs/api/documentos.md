# Documentos médicos

Regras definidas antes da implementação (seção 30 do Prompt Mestre). Atende à seção 3.7 do Prompt Mestre, ao módulo `documents` de [03-arquitetura.md](../planejamento/03-arquitetura.md) e à primeira fase depois do MVP no plano ([04-plano-do-mvp.md](../planejamento/04-plano-do-mvp.md)).

> **Não é assinatura ICP-Brasil e não está validado juridicamente.** Os documentos são assinados com a mesma **assinatura eletrônica interna** do prontuário (reautenticação, resumo SHA-256 e evidências). Documentos que saem da clínica, como receitas e atestados, podem exigir certificado ICP-Brasil; isso depende de **validação jurídica** (Res. CFM 1.821/2007, Lei 14.063/2020, normas de prescrição eletrônica) e de um provedor pago, que só será contratado com autorização. Os campos de cada documento são uma proposta técnica a validar com os médicos. Nada aqui declara conformidade.

## Tipos de documento

| Tipo           | Nome             | Campos (proposta a validar)                                                                                              |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `prescription` | Receita simples  | 1 a 20 itens, cada um com medicamento, posologia e quantidade (opcional); observações (opcional)                         |
| `certificate`  | Atestado         | finalidade (`absence`, afastamento, ou `attendance`, comparecimento); dias de afastamento; data de início; CID-10; texto |
| `exam_request` | Pedido de exames | 1 a 30 exames, cada um com observação opcional; indicação clínica e CID-10 (opcionais)                                   |
| `referral`     | Encaminhamento   | especialidade de destino, motivo e resumo clínico (opcional)                                                             |
| `report`       | Relatório médico | título e texto                                                                                                           |

Regras de conteúdo:

- **Atestado de afastamento** exige de 1 a 365 dias. O de comparecimento não tem dias.
- **CID no atestado** só com a autorização do paciente: se houver CID, o campo `icd10Authorized` precisa ser `true` (Res. CFM 1.658/2002, a validar). Sem a marcação, a API recusa.
- O CID-10 tem só o formato conferido (por exemplo `J06.9`), como no prontuário.
- **Receita de controle especial** (Portaria SVS/MS 344/1998) e receita antimicrobiana em duas vias **não** são atendidas. A tela avisa que a receita simples não serve para esses medicamentos. A API não tem como reconhecer o medicamento e não tenta.
- Textos curtos até 300 caracteres; textos longos até 4.000 (20.000 no relatório).

## Estados

| Estado      | Quem vê                        | Pode ir para            |
| ----------- | ------------------------------ | ----------------------- |
| `draft`     | só o autor                     | `signed` ou `discarded` |
| `signed`    | quem tem acesso aos documentos | `cancelled`, com motivo |
| `cancelled` | quem tem acesso aos documentos | —                       |
| `discarded` | só o autor                     | —                       |

- **Nada é apagado.** O banco recusa `DELETE` em documentos e eventos.
- O rascunho pode ser alterado à vontade pelo autor. A gravação exige a `version` que a pessoa estava editando; se outra gravação veio antes, a resposta é 409 `VERSION_CONFLICT`.
- **Cancelar** um documento assinado (por exemplo, atestado emitido com erro) exige motivo de 10 a 1.000 caracteres. O documento continua visível, marcado como cancelado, e o PDF passa a sair com a faixa "CANCELADO". Para corrigir, emite-se um documento novo.
- Toda mudança de estado gera um evento somente-acréscimo, com quem, quando e o motivo.

## Assinatura

- Só o autor assina, só um rascunho, e só com **reautenticação recente** (403 `REAUTH_REQUIRED`).
- O médico precisa ter **registro profissional** ativo (CRM e UF). Sem ele, a criação e a assinatura são recusadas (422).
- Ao assinar, a API tira um **retrato** do que o documento identifica, que fica congelado junto com o conteúdo:
  - emitente: nome, CRM/UF, especialidades e RQE;
  - paciente: nome civil, nome social (quando houver) e data de nascimento;
  - local: organização e unidade do atendimento;
  - data de emissão (data local da unidade).
- A API calcula o SHA-256 do conteúdo canônico (identificador, tipo, paciente, autor, retrato, conteúdo e data de emissão, com as chaves em ordem) e grava o resumo com as evidências da assinatura (sessão, momento da reautenticação, IP, identificador da requisição).
- **Depois de assinado, o documento fica congelado no banco.** Um gatilho recusa alterar conteúdo, retrato, resumo, evidências, autor ou paciente. Só a mudança para `cancelled` (com motivo, quem e quando) é aceita.
- `GET /documents/:id` recalcula o resumo e informa `integrity: "valid"` ou `"invalid"`.
- Repetir a assinatura não duplica nada: a gravação é condicional à versão e ao estado, e a segunda tentativa recebe 409. Por isso a assinatura não usa o cabeçalho `Idempotency-Key` previsto na arquitetura (ver ADR 0018).

## PDF

`GET /documents/:id/pdf` gera o PDF na hora, a partir do documento gravado (o PDF não é guardado):

- cabeçalho com organização e unidade; título do tipo; paciente; conteúdo; local e data; nome, CRM/UF e RQE do emitente;
- rodapé com o identificador do documento, o resumo SHA-256 e a frase "Assinado eletronicamente no sistema (assinatura interna, sem certificado ICP-Brasil)";
- rascunho sai com a faixa "RASCUNHO — SEM VALIDADE"; cancelado, com "CANCELADO";
- rascunho de outro autor não existe (404), como no prontuário.

Gerar o PDF conta como a ação `export` na política e fica na auditoria, com o paciente.

## Quem pode o quê

O recurso na política é `medical_document`, de dado clínico. Segue o vínculo assistencial ([atendimento-e-vinculo.md](atendimento-e-vinculo.md)), como o prontuário (proposta a validar com os médicos):

| Vínculo                         | Ver            | Criar e editar rascunho | Assinar | Cancelar (autor) | PDF            |
| ------------------------------- | -------------- | ----------------------- | ------- | ---------------- | -------------- |
| Agendado ou confirmado          | —              | —                       | —       | —                | —              |
| Atendimento iniciado            | sim            | sim                     | sim     | sim              | sim            |
| Acompanhamento ativo            | sim            | sim                     | sim     | sim              | sim            |
| Encerrado (período de cortesia) | sim            | só editar               | sim     | sim              | sim            |
| Expirado                        | só os próprios | —                       | —       | sim              | só os próprios |

- Editar, assinar e cancelar são só do autor.
- O autor sempre vê, cancela e gera o PDF dos próprios documentos, mesmo com o vínculo expirado (obrigação documental).
- O acesso emergencial não libera documentos.
- **Secretária e administrador nunca acessam.** Entregar o documento impresso pela recepção é uma decisão a tomar depois, porque o documento contém dado clínico.
- Documentos não têm nível de sensibilidade próprio nesta fase: quem tem vínculo vê todos os documentos assinados do paciente. Se for preciso esconder, por exemplo, um atestado com CID psiquiátrico, isso entra junto com a validação clínica da sensibilidade.

## Endpoints (`/api/v1`, sessão `active`)

| Método e rota                  | O que faz                                                        |
| ------------------------------ | ---------------------------------------------------------------- |
| `POST /patients/:id/documents` | cria rascunho `{ kind, content }`, ligado ao atendimento aberto  |
| `GET /patients/:id/documents`  | lista os documentos visíveis, do mais recente para o mais antigo |
| `GET /documents/:id`           | documento com `integrity`                                        |
| `GET /documents/:id/history`   | eventos do documento                                             |
| `PATCH /documents/:id`         | grava o rascunho `{ version, content }`                          |
| `POST /documents/:id/sign`     | assina `{ version }` (reautenticação recente)                    |
| `POST /documents/:id/discard`  | descarta o rascunho                                              |
| `POST /documents/:id/cancel`   | cancela o assinado `{ reason }`                                  |
| `GET /documents/:id/pdf`       | PDF do documento                                                 |

Toda rota tem teste de acesso permitido e negado (`apps/api/test/documents.test.ts`).

## Limites conhecidos

- Assinatura interna, sem ICP-Brasil e sem validação jurídica (ver o aviso no início).
- Sem receita de controle especial, sem receita antimicrobiana e sem integração com plataformas de prescrição eletrônica.
- A unidade ainda não tem endereço cadastrado, que receitas costumam exigir. Entra quando os campos forem validados.
- Não há verificação pública de autenticidade (QR code ou página de conferência). É uma superfície exposta na internet e fica para quando houver hospedagem e validação jurídica.
- Os mesmos limites do prontuário sobre o papel dono das tabelas valem aqui ([prontuario.md](prontuario.md)).
