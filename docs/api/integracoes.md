# Integrações

Regras definidas antes da implementação. Esta fase cobre duas integrações que **não dependem de
nenhum serviço contratado**:

1. a **cópia do prontuário no padrão FHIR R4**, para o paciente levar a outro serviço de saúde;
2. a **importação de pacientes por planilha** (CSV), para trazer o cadastro de outro sistema.

Integrações com serviços externos (RNDS, laboratórios, gateways de pagamento, WhatsApp de
verdade) ficam para depois e só com a sua autorização, porque exigem contrato, credenciais ou
homologação.

## 1. Cópia do prontuário no padrão FHIR

### O que é

O FHIR (Fast Healthcare Interoperability Resources, da HL7) é o padrão internacional de troca de
dados de saúde, usado também pela RNDS do Ministério da Saúde. A cópia FHIR traz **exatamente o
mesmo conteúdo** da cópia em JSON próprio (`docs/api/direitos-do-titular.md`), só que num formato
que outros sistemas entendem.

### Quem gera

As mesmas regras da cópia atual, sem exceção:

- só o **médico com vínculo valendo** (atendimento iniciado, acompanhamento ou encerrado);
- exige **reautenticação recente**;
- acesso emergencial e justificativa **não** liberam nada na cópia;
- secretária, administrador e médico sem vínculo são negados (403); paciente de outra
  organização ou inexistente é 404;
- a geração é auditada como `export` de `clinical_record`, como a cópia em JSON.

### Rota

| Rota                                   | O que faz                                 |
| -------------------------------------- | ----------------------------------------- |
| `GET /patients/:id/clinical-copy/fhir` | cópia do prontuário como `Bundle` FHIR R4 |

Resposta `application/fhir+json`, baixada como `copia-do-prontuario-fhir-AAAA-MM-DD.json`.

### Como os dados viram FHIR

O arquivo é um `Bundle` do tipo `collection`. Cada recurso tem `fullUrl` `urn:uuid:<id>` e as
referências entre eles apontam para esses endereços, então o arquivo se sustenta sozinho.

| No CRM                              | No FHIR                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Organização                         | `Organization` (nome)                                                             |
| Paciente                            | `Patient` (nome usado, nome civil, data de nascimento)                            |
| Autor de registro ou documento      | `Practitioner` (nome e CRM/UF, quando houver)                                     |
| Registro assinado                   | `Composition` com status `final` (ou `amended` se retificado)                     |
| Seções do registro                  | `Composition.section` com código LOINC e texto                                    |
| Hipótese diagnóstica                | `Condition` provisória, com CID-10 quando informado                               |
| Retificação / adendo                | `Composition.relatesTo` `replaces` / `appends`                                    |
| Documento médico assinado/cancelado | `DocumentReference` (`current` / `entered-in-error`) com o conteúdo em anexo JSON |
| Aviso e itens que ficaram de fora   | `OperationOutcome` com mensagens informativas                                     |

Códigos usados:

- tipo do registro (LOINC): consulta `11488-4`, evolução e adendo `11506-3`;
- seções (LOINC): queixa principal `10154-3`, anamnese `10164-2`, exame físico `29545-1`,
  hipóteses `51848-0`, conduta `18776-5`;
- CID-10: sistema `http://hl7.org/fhir/sid/icd-10`;
- CRM: identificador com sistema próprio `urn:crm-medico:crm:<UF>` (não há sistema oficial
  publicado para CRM no FHIR internacional; os perfis da RNDS usam outros identificadores e
  ficam para a integração com a RNDS).

O resumo (hash) de assinatura de cada registro e documento vai como `identifier` com o sistema
`urn:crm-medico:sha256`, para quem receber poder conferir que o conteúdo não mudou.

### O que fica de fora de propósito

- **CPF**: não vai na cópia, igual à cópia em JSON (o paciente já sabe o próprio CPF e o arquivo
  pode circular). Quando houver integração com a RNDS, o CPF entra conforme o perfil oficial.
- **Rascunhos, descartados e sensíveis de outros profissionais**: as mesmas regras da cópia.

### Limites honestos

- O arquivo segue a estrutura do FHIR R4 (conferida pelos tipos `@types/fhir` na compilação e por
  testes automáticos), mas **não foi validado pelo validador oficial da HL7** nem pelos perfis
  brasileiros da RNDS: o validador precisa baixar pacotes de um servidor que este ambiente não
  alcança. Antes de usar em integração real, rodar o validador oficial e os perfis da RNDS.
- Não é um "documento clínico assinado" no sentido do FHIR (`Bundle` do tipo `document` com
  assinatura digital ICP-Brasil); a assinatura continua sendo a interna do sistema.

## 2. Importação de pacientes por planilha

### Quem pode

Quem pode **cadastrar paciente** (`patient`/`create`): a secretária. Médico e administrador não
importam. A rota é negada por padrão como todas as outras.

### Como funciona

Em dois passos, para nada entrar sem conferência:

1. **Conferir** (`POST /patients/import/preview`): a recepção envia o conteúdo do arquivo CSV e a
   API devolve, linha por linha, se ela **entra**, se tem **erro** (e qual) ou se é
   **possível duplicidade** (CPF já cadastrado, ou mesmo nome e data de nascimento, ou repetida
   dentro do próprio arquivo). Nada é gravado.
2. **Importar** (`POST /patients/import`): mesmo conteúdo. A API confere tudo de novo e cadastra
   **só as linhas sem erro e sem duplicidade**, cada uma pelo mesmo caminho do cadastro manual
   (versão inicial no histórico e evento de auditoria). Devolve o resultado por linha, com o id
   de cada paciente criado.

Se o arquivo inteiro for inválido (sem cabeçalho reconhecido, grande demais, linhas demais), a
resposta é 400 e nada é gravado.

### O arquivo

- CSV em UTF-8 (o que o Excel salva como "CSV UTF-8"), separado por **ponto e vírgula** ou
  **vírgula** (detectado pelo cabeçalho). Campos entre aspas podem conter o separador.
- No máximo **500 linhas** de pacientes e **1 MB** por arquivo.
- A primeira linha é o cabeçalho. Colunas reconhecidas (sem diferença de maiúsculas e acentos):

| Coluna                                                                 | Obrigatória | Observação                                                    |
| ---------------------------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| `nome`                                                                 | sim         | nome civil completo                                           |
| `nome_social`                                                          | não         |                                                               |
| `cpf`                                                                  | não         | com ou sem pontuação; inválido vira erro da linha             |
| `data_nascimento`                                                      | sim         | `DD/MM/AAAA` ou `AAAA-MM-DD`                                  |
| `telefone`                                                             | sim         | DDD + número                                                  |
| `telefone_whatsapp`                                                    | não         | `sim` ou `não` (vazio = não)                                  |
| `email`                                                                | não         |                                                               |
| `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `cidade`, `uf` | não         | endereço: ou vêm todos os obrigatórios do endereço, ou nenhum |

Colunas desconhecidas são ignoradas e avisadas na conferência.

### O que nunca vem da planilha

- **Consentimentos de comunicação** (canais, lembretes, marketing): todo paciente importado entra
  **sem nenhuma autorização**. Consentimento é do paciente e precisa ser registrado com ele, não
  copiado de outro sistema. A recepção autoriza depois, no cadastro.
- **Dados clínicos**: a importação é só de cadastro. Prontuário de outro sistema exige outra
  integração, com regras próprias.

### Privacidade

- O arquivo não é guardado: a API lê, confere e descarta.
- A resposta da conferência não repete CPF nem telefone; mostra a linha, o nome e o motivo.
- A auditoria registra um evento por paciente criado (como no cadastro manual) e um evento da
  importação com quantas linhas entraram, quantas tinham erro e quantas eram duplicidade.

## Testes de aceite

- Cópia FHIR: o médico com vínculo baixa um `Bundle` com `Patient`, `Practitioner`,
  `Composition` dos registros assinados e `DocumentReference` dos documentos; toda referência
  aponta para um recurso do próprio arquivo; sensíveis de outros não aparecem e o
  `OperationOutcome` conta o que ficou de fora; sem reautenticação dá 403; secretária,
  administrador e médico sem vínculo dão 403; paciente inexistente dá 404.
- Importação: a conferência aponta erro de CPF, data, telefone e endereço incompleto, e
  duplicidade por CPF, por nome e nascimento e dentro do arquivo, sem gravar nada; a importação
  cria só as linhas boas, sem consentimento, com versão e auditoria; médico e administrador dão
  403; arquivo sem cabeçalho ou com mais de 500 linhas dá 400.
