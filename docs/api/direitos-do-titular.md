# Direitos do paciente (titular dos dados)

Regras definidas antes da implementação. Cobrem as lacunas de LGPD apontadas na
[matriz de conformidade](../conformidade/matriz-de-conformidade.md): registro dos pedidos do
titular (art. 18), relatório de quem acessou os dados e exportação dos dados.

> **Prazos e formatos a validar com o encarregado de dados e um advogado.** O prazo de 15 dias
> segue o art. 19, II da LGPD para a declaração completa. O sistema ajuda a cumprir, mas não
> decide sozinho o que pode ser negado.

## Pedidos do titular

A secretária registra o pedido quando o paciente o faz na recepção, por telefone ou por escrito
(`privacy.subject_requests`):

- tipo: `access` (confirmação e acesso aos dados), `access_report` (quem acessou),
  `correction` (correção), `portability` (cópia em formato aberto), `deletion` (eliminação ou
  anonimização), `sharing_info` (com quem os dados foram compartilhados) ou `other`;
- detalhes (até 1000 caracteres), quem registrou e quando;
- **prazo**: 15 dias corridos a partir do registro, calculado pelo sistema;
- situação: `open` (aberto), `completed` (atendido) ou `denied` (negado). Concluir ou negar
  exige a resposta dada ao paciente (3 a 1000 caracteres) e não pode ser desfeito.

Nada é apagado: o banco recusa `DELETE` e não deixa mudar o pedido depois de concluído. A lista
mostra primeiro os abertos, com aviso dos vencidos.

**Eliminação:** o prontuário tem guarda obrigatória (Lei 13.787/2018), então um pedido de
eliminação de dado clínico é respondido com a justificativa da guarda. A anonimização do que não
é de guarda obrigatória fica para depois.

## Relatório de acessos

`GET /patients/:id/access-report` lista, a partir da trilha de auditoria, cada vez que alguém
tentou ver ou mexer em dados desse paciente:

- data e hora, pessoa (nome e perfil), o que foi acessado (cadastro, consulta, atendimento,
  resumo clínico, registro do prontuário, documento, acesso emergencial, cobrança), ação,
  resultado (permitido ou negado) e se foi acesso emergencial;
- período opcional (`from`, `to`), no máximo 2000 linhas, mais recentes primeiro.

**Não mostra conteúdo clínico**, só o fato do acesso. Quem gera o relatório também fica na
auditoria.

## Exportação dos dados

`GET /patients/:id/export` exige **reautenticação recente** (o arquivo traz o CPF e todo o cadastro) e devolve um arquivo JSON (formato aberto, para portabilidade) com:

- cadastro completo (inclusive CPF), telefones, contatos e responsáveis;
- consultas (data, profissional, unidade, situação);
- cobranças e pagamentos;
- pedidos do titular já registrados.

A parte clínica não vai nesse arquivo: o aviso diz que a cópia do prontuário é gerada pelo médico
que acompanha o paciente, em arquivo separado.

## Cópia do prontuário

Decisão (2026-10-31, opção recomendada enquanto o responsável não escolhe outra): **quem gera é o
médico com vínculo valendo** com o paciente, sem criar perfil novo com acesso a todo o
prontuário ([ADR 0022](../adr/0022-copia-do-prontuario-pelo-medico-com-vinculo.md)).

`GET /patients/:id/clinical-copy`:

- só médico, com vínculo `started`, `follow_up` ou `closed`. Agendamento, vínculo expirado e
  acesso emergencial **não** geram a cópia, nem para os próprios registros;
- exige **reautenticação recente** e fica na auditoria como `export` de `clinical_record`;
- devolve um arquivo JSON (`crm-medico/copia-do-prontuario`, versão 1) com os **registros
  assinados** (inclusive os retificados, com o vínculo para a retificação) e os **documentos
  assinados ou cancelados**, cada um com o conteúdo, o autor, a data, o hash e a verificação de
  integridade;
- leva só o que esse médico lê **sem justificativa**: registros sensíveis de outros autores ficam
  de fora, e o arquivo diz quantos ficaram de fora e que devem ser pedidos ao autor ou ao diretor
  técnico. Rascunhos e registros não assinados nunca entram.

A secretária registra o pedido e responde quando a cópia for entregue; ela não gera nem vê a
cópia.

## Quem pode o quê

Recurso `patient_rights`, sem escopo de unidade (o paciente é da organização):

| Ação                                          | Médico              | Secretária | Administrador |
| --------------------------------------------- | ------------------- | ---------- | ------------- |
| Ver pedidos e o relatório de acessos (`view`) | —                   | sim        | —             |
| Registrar pedido (`create`)                   | —                   | sim        | —             |
| Concluir ou negar pedido (`edit`)             | —                   | sim        | —             |
| Exportar os dados do paciente (`export`)      | —                   | sim        | —             |
| Gerar a cópia do prontuário                   | com vínculo valendo | —          | —             |

- O administrador não vê pacientes, então não atende pedidos; ele continua vendo a auditoria.
- A secretária já vê cadastro, agenda e financeiro; o relatório de acessos não mostra conteúdo
  clínico.

## Endpoints (`/api/v1`, sessão `active`)

| Método e rota                        | O que faz                                     |
| ------------------------------------ | --------------------------------------------- |
| `GET /privacy/requests`              | lista (`status`, `patientId` opcionais)       |
| `POST /privacy/requests`             | registra `{ patientId, kind, details? }`      |
| `POST /privacy/requests/:id/resolve` | conclui ou nega `{ status, resolution }`      |
| `GET /patients/:id/access-report`    | relatório de acessos (`from`, `to` opcionais) |
| `GET /patients/:id/export`           | arquivo JSON com os dados do paciente         |
| `GET /patients/:id/clinical-copy`    | cópia do prontuário (médico com vínculo)      |

Toda rota tem teste de acesso permitido e negado (`apps/api/test/privacy.test.ts`).
