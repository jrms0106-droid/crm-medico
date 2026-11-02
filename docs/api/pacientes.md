# Cadastro de pacientes

Regras definidas antes da implementação (seção 30 do Prompt Mestre). Atende às seções 4 e 16 do Prompt Mestre e à Etapa 3 do plano.

## O que o cadastro guarda (e o que não guarda)

O cadastro é **dado pessoal**, não clínico. Nada sobre saúde entra aqui: alergias, problemas e motivos de consulta ficam no prontuário (Etapa 6). A lista de campos segue a seção 4 do Prompt Mestre, e qualquer campo novo precisa de justificativa (minimização de dados, LGPD).

| Campo                       | Obrigatório                                 | Regras                                                                                                                |
| --------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Nome completo               | sim                                         | 3 a 200 caracteres                                                                                                    |
| Nome social                 | não                                         | 2 a 200 caracteres. Quando existe, é o nome exibido em telas e listas                                                 |
| CPF                         | não (crianças e estrangeiros podem não ter) | Dígitos verificadores válidos. Único na organização                                                                   |
| Data de nascimento          | sim                                         | Formato `AAAA-MM-DD`, entre 1900 e hoje                                                                               |
| Telefones                   | ao menos 1, até 5                           | DDD + número: 10 dígitos (fixo) ou 11 começando com 9 (celular). Marca se o número usa WhatsApp                       |
| E-mail                      | não                                         | Formato válido                                                                                                        |
| Endereço                    | não                                         | CEP (8 dígitos), logradouro, número, complemento, bairro, cidade, UF                                                  |
| Responsáveis legais         | sim se menor de 18 anos, até 3              | Nome, parentesco, telefone e e-mail opcionais                                                                         |
| Contatos de emergência      | não, até 3                                  | Nome, parentesco, telefone obrigatório                                                                                |
| Preferências de comunicação | sim, com padrão "nada autorizado"           | Canais permitidos (WhatsApp, SMS, e-mail, ligação), lembretes de consulta (sim/não), mensagens promocionais (sim/não) |

- **Preferências de comunicação começam desligadas.** Só valem os canais que o paciente autorizou. O e-mail só pode ser autorizado se houver e-mail no cadastro, o WhatsApp se algum telefone usar WhatsApp, e o SMS se houver celular. O módulo de mensagens (fora do MVP) só poderá usar o que estiver aqui.
- **Nome social** é exibido no lugar do nome civil em telas e listas. O nome civil continua no cadastro.
- **Nada é apagado.** O paciente pode ser marcado como inativo e deixa de aparecer na busca, a menos que se peça para incluir inativos.

## Proteção do CPF

O CPF é guardado **criptografado** (AES-256-GCM, com a chave `PII_ENCRYPTION_KEY`). Para impedir repetição e permitir a busca exata sem decifrar todos os registros, o banco guarda também um resumo (HMAC-SHA256 com uma chave derivada da mesma variável). Com isso:

- a busca por CPF exige o número completo;
- listas e resultados de busca mostram o CPF mascarado (`***.456.789-**`), e só a ficha completa mostra o número inteiro;
- o histórico registra que o CPF mudou, mas não guarda o valor.

## Duplicidade

- **CPF repetido** na organização é bloqueado (409 `CPF_ALREADY_REGISTERED`), inclusive se o outro cadastro estiver inativo.
- **Possível duplicidade**: mesma data de nascimento com nome parecido, ou um mesmo telefone já cadastrado em outro paciente. Nesses casos o cadastro é recusado com 409 `POSSIBLE_DUPLICATE`, e os ids dos cadastros parecidos vão em `details`. Para gravar mesmo assim, depois de conferir, reenvie com `allowPossibleDuplicate: true`. A decisão fica registrada na auditoria.
- **Nome parecido** quer dizer que, depois de tirar acentos e maiúsculas, metade ou mais das palavras do nome coincidem (ignorando "da", "de", "do", "dos", "das" e "e"), ou que um nome contém o outro.
- `POST /patients/duplicate-check` permite à tela avisar antes de a pessoa terminar de preencher.

## Busca

`POST /patients/search` com `{ q }` no corpo procura em pacientes ativos da organização. A busca vai no corpo, e não no endereço, para o CPF e o telefone não ficarem em registros de proxy nem no histórico do navegador ([ADR 0033](../adr/0033-busca-e-justificativa-no-corpo.md)):

- **Texto:** cada palavra digitada precisa aparecer no nome completo ou no nome social, sem diferença de acentos e maiúsculas ("jose" encontra "José"; "maria silva" encontra "Maria da Silva").
- **Números:** com 11 dígitos de um CPF válido, procura o CPF exato e também telefones. Com 4 ou mais dígitos, procura telefones que contenham esses dígitos.
- Pontuação é ignorada (`123.456.789-09`, `(11) 98765-4321`).
- Até 20 resultados por padrão (`limit` até 50), ordenados por nome.

## Histórico de alterações

Toda criação e alteração gera uma **versão** numerada, com quem alterou, quando e quais campos mudaram, além da fotografia do cadastro naquele momento (sem o CPF). As versões nunca são alteradas nem apagadas: um gatilho no banco recusa `UPDATE` e `DELETE`, como na auditoria.

Edição concorrente: o `PATCH` exige a `version` que a pessoa estava vendo. Se outra pessoa salvou antes, a resposta é 409 `VERSION_CONFLICT` e nada é gravado. A tela pode então mostrar a versão atual.

## Permissões

Pela matriz da Etapa 2 ([organizacao-e-permissoes.md](organizacao-e-permissoes.md)), o recurso `patient_registration` permite:

- **médico e secretária:** visualizar, criar e editar;
- **administrador:** nada (403). O administrador gerencia a clínica, não os pacientes. Quem também é médico ou secretária acessa pelo outro papel.

O cadastro é da organização, não da unidade: qualquer secretária ou médico da organização encontra o paciente. Toda leitura e alteração gera evento de auditoria com o id do paciente. Na criação há dois eventos, a decisão de acesso e o registro do paciente criado.

## Endpoints (`/api/v1`, sessão `active`)

| Método e rota                    | Ação   | Corpo / parâmetros                                                 | Resposta                                                                                       |
| -------------------------------- | ------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `POST /patients/search`          | view   | `{ q (mín. 2 caracteres), includeInactive?, limit? }`              | 200 `PatientSummary[]`                                                                         |
| `POST /patients/duplicate-check` | create | `{ fullName, birthDate, cpf?, phones? }`                           | 200 `PatientSummary[]` com os parecidos                                                        |
| `POST /patients`                 | create | `PatientInput` + `allowPossibleDuplicate?`                         | 201 `Patient`; 409 `CPF_ALREADY_REGISTERED` ou `POSSIBLE_DUPLICATE`; 422 menor sem responsável |
| `GET /patients/:id`              | view   | —                                                                  | 200 `Patient`; 404                                                                             |
| `PATCH /patients/:id`            | edit   | `{ version, ...campos a mudar }` (listas substituem as anteriores) | 200 `Patient`; 409 `VERSION_CONFLICT` ou `CPF_ALREADY_REGISTERED`                              |
| `GET /patients/:id/history`      | view   | —                                                                  | 200 `PatientVersion[]`, da mais recente para a mais antiga                                     |

- `PatientSummary` = `{ id, displayName, fullName, socialName, birthDate, cpfMasked, primaryPhone, active }`
- `Patient` = todos os campos da tabela acima, mais `id`, `displayName`, `active`, `version`, `createdAt` e `updatedAt`.
- `PatientVersion` = `{ version, changedAt, changedBy: { id, name }, changedFields, snapshot }`

## Erros específicos

`CPF_ALREADY_REGISTERED` (409), `POSSIBLE_DUPLICATE` (409), `VERSION_CONFLICT` (409), `VALIDATION_FAILED` (400, campo a campo), `BUSINESS_RULE_VIOLATION` (422).

## Fora desta etapa

Unificação de cadastros duplicados, consentimentos detalhados por finalidade (LGPD), foto do paciente, importação de cadastros e telas (Etapa 7).
