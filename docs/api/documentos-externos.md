# Documentos emitidos fora do CRM (plataforma do CFM)

Regras definidas antes da implementação (2026-11-02, escolha do responsável depois do
[comparativo de fornecedores](../operacao/comparativo-de-fornecedores.md)).

> **O CRM não emite nem assina estes documentos.** O médico emite a receita, o atestado ou o pedido
> na [Plataforma de Prescrição Eletrônica do CFM](https://prescricaoeletronica.cfm.org.br/), que é
> gratuita e assina com certificado ICP-Brasil. No CRM ele só **registra** que emitiu, para o
> histórico do paciente ficar completo. O CRM não confere o código digitado com o CFM nem com o
> validador do ITI: não há integração. Quem precisa conferir a autenticidade usa
> [validar.iti.gov.br](https://validar.iti.gov.br) com o PDF que o paciente recebeu.

## O que se registra

| Campo            | Regra                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`           | `prescription` (receita simples), `controlled_prescription` (controle especial), `antimicrobial_prescription` (antimicrobiano), `certificate` (atestado), `exam_request` (pedido de exames) ou `other` |
| `issuedOn`       | data de emissão; não pode ser no futuro (data local da unidade, `America/Sao_Paulo`) nem antes de 1º de janeiro de 2020                                                                                |
| `summary`        | o que foi emitido, em texto livre, de 3 a 2.000 caracteres (por exemplo, os medicamentos e a posologia)                                                                                                |
| `validationCode` | opcional, até 100 caracteres: o código ou identificador que a plataforma mostra no documento. O formato não é conferido, porque o CRM não sabe o formato do CFM.                                       |

- A plataforma fica gravada como `cfm`. Outras plataformas entram quando forem pedidas.
- O registro fica ligado ao atendimento aberto do médico com o paciente, quando houver, e à unidade
  desse atendimento.
- **Não guarda o PDF.** Guardar arquivo exige armazenamento de anexos, que ainda não existe.

## Estados e correção

| Estado       | Pode ir para            |
| ------------ | ----------------------- |
| `registered` | `cancelled`, com motivo |
| `cancelled`  | —                       |

- Não há rascunho: o registro já nasce `registered`, porque o documento já foi emitido lá fora.
- **Nada é apagado nem alterado.** Um gatilho no banco recusa `DELETE` e qualquer mudança que não
  seja o cancelamento (motivo de 10 a 1.000 caracteres, quem e quando).
- Cancelar aqui só diz que o **registro** está errado (por exemplo, paciente trocado). Cancelar o
  documento de verdade é feito na plataforma do CFM; a tela avisa isso.
- Para corrigir, cancela-se e registra-se de novo.

## Quem pode o quê

Usa o mesmo recurso da política dos documentos médicos, `medical_document`, e o mesmo vínculo
assistencial ([documentos.md](documentos.md), "Quem pode o quê"):

- **Registrar** é `create`: médico com atendimento iniciado ou acompanhamento ativo.
- **Ver** é `view`: quem pode ver os documentos do paciente; o autor sempre vê os próprios.
- **Cancelar** é `correct`, só do autor, mesmo com o vínculo expirado.
- Secretária e administrador nunca acessam. O acesso emergencial não libera.

## Endpoints (`/api/v1`, sessão `active`)

| Método e rota                           | O que faz                                                       |
| --------------------------------------- | --------------------------------------------------------------- |
| `POST /patients/:id/external-documents` | registra `{ kind, issuedOn, summary, validationCode? }` (201)   |
| `GET /patients/:id/external-documents`  | lista os registros visíveis, do mais recente para o mais antigo |
| `POST /external-documents/:id/cancel`   | cancela o registro `{ reason }`                                 |

Toda rota tem teste de acesso permitido e negado (`apps/api/test/external-documents.test.ts`).

## Limites conhecidos

- Sem integração com o CFM: o código não é conferido e o documento não é baixado.
- Sem anexo do PDF.
- A IA não lê estes registros nesta fase.
- As cópias do prontuário, em JSON e no padrão FHIR, levam os registros não cancelados
  ([direitos-do-titular.md](direitos-do-titular.md), [integracoes.md](integracoes.md),
  [ADR 0036](../adr/0036-documentos-do-cfm-na-copia-fhir.md)). O documento assinado com
  ICP-Brasil continua só na plataforma do CFM.
