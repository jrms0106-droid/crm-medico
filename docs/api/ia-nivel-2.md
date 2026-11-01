# IA nível 2: assistente documental do médico

Regras definidas antes da implementação (seções 14 e 15 da especificação). O nível 2 ajuda o
**médico** a documentar: organiza as anotações dele nos campos do registro e resume o
prontuário apontando de onde veio cada trecho. Ele trabalha com dado clínico, então segue as
mesmas regras de acesso do prontuário, e mais algumas.

> **Rascunho, nunca registro.** Tudo o que a IA produz aparece identificado como rascunho. Nada
> entra no prontuário sem o médico inserir no próprio rascunho, revisar, salvar e assinar. A IA
> não grava, não assina e não envia nada.

## Princípio: a IA só reorganiza o que já existe

O modelo **não escreve texto clínico**. Ele recebe as frases numeradas (as anotações do médico,
ou os registros assinados do prontuário) e devolve só **códigos** dessas frases (`S3`, `R2.S1`).
O sistema confere os códigos e monta o resultado com as **frases originais, sem mudar uma
letra**. Assim, por construção, a IA não consegue inventar sintoma, achado, diagnóstico ou
conduta: ela só escolhe onde cada frase do próprio médico se encaixa.

Isso segue o mesmo desenho da organização da agenda do nível 1 (ADR 0026) e a regra da
arquitetura de que todo resumo aponta para o trecho original (`docs/planejamento/03-arquitetura.md`,
seção 11).

## Modelo simulado

Como no nível 1, não há serviço de IA contratado: as respostas vêm de um **modelo simulado**
(regras fixas dentro da API, sem enviar nada para fora). Trocar por um fornecedor é um
adaptador novo e depende da sua autorização, depois de avaliar contrato, retenção,
transferência internacional, uso para treinamento e enquadramento regulatório.

## Funcionalidades

| Funcionalidade                  | Chave            | Quem usa | O que faz                                                                              |
| ------------------------------- | ---------------- | -------- | -------------------------------------------------------------------------------------- |
| Organizar anotações no registro | `record_draft`   | médico   | distribui as frases das anotações do médico entre motivo, anamnese, exame e conduta    |
| Resumo do prontuário com fontes | `record_summary` | médico   | escolhe os trechos principais dos registros assinados, cada um com data, autor e fonte |

Cada uma tem um interruptor próprio, **desligado por padrão**, que só o administrador liga ou
desliga (com senha e código), como no nível 1.

### Organizar anotações no registro

Entrada: o paciente e as anotações do médico (texto livre, até 8.000 caracteres), por exemplo o
que ele digitou durante a consulta.

1. O sistema divide o texto em frases (por ponto final, ponto de interrogação, exclamação,
   ponto e vírgula e quebra de linha), numeradas `S1`, `S2`… (no máximo 60 frases).
2. O modelo devolve, para cada campo, a lista de códigos: `chiefComplaint` (motivo da consulta),
   `anamnesis` (anamnese), `physicalExam` (exame físico) e `plan` (conduta).
3. O sistema confere: só códigos que existem, cada frase em no máximo um campo. Se algo vier
   errado, a resposta inteira é descartada (erro 502, `AI_INVALID_OUTPUT`).
4. A tela mostra cada campo com as frases originais e, à parte, as frases que o modelo **não
   usou**, para nada se perder.
5. **Inserir no registro** acrescenta o texto ao fim de cada campo do rascunho aberto. O
   salvamento automático e a assinatura seguem as regras do prontuário.

**Hipóteses diagnósticas e CID nunca são preenchidos pela IA.** Esse campo continua só do
médico.

### Resumo do prontuário com fontes

Entrada: o paciente.

1. O sistema junta os registros **assinados** do paciente que o médico pode ler agora (mesma
   regra de cada registro da linha do tempo), do mais recente para o mais antigo, no máximo 10.
2. Ficam **de fora**: rascunhos, registros arquivados, retificados (vale a retificação) e
   registros sensíveis de outro médico que pedem justificativa. A tela diz quantos sensíveis
   ficaram de fora; para vê-los, o médico abre o registro com justificativa, como sempre.
3. As frases de cada registro são numeradas `R1.S1`, `R1.S2`… e o modelo devolve até 12 itens,
   cada um com o campo e os códigos das frases.
4. O sistema confere os códigos e mostra cada item com a frase original, a data, o tipo e o
   autor do registro de onde veio, e um botão para abrir esse registro.

O resumo não é um registro: ele não é guardado e não entra no prontuário.

## Permissões

Duas checagens, as duas no servidor:

1. **Usar o assistente clínico** (recurso `ai_clinical`, novo): só o perfil Médico. Secretária e
   administrador recebem 403.
2. **O próprio prontuário**: organizar anotações exige poder **criar registro** para aquele
   paciente (vínculo em atendimento iniciado ou acompanhamento); o resumo exige vínculo que
   permita **ver o prontuário** (atendimento iniciado, acompanhamento ou encerrado). Sem vínculo
   ou com vínculo expirado, 403, mesmo para os próprios registros (na linha do tempo o autor
   continua vendo os dele; mandar à IA pede mais). Paciente de outra organização ou
   inexistente, 404.

Tudo é auditado como o resto do prontuário. Os interruptores ficam visíveis para o médico (ver,
não mudar), para a tela saber se mostra os botões.

## O que fica guardado

Diferente do nível 1, o histórico de uso **não guarda o texto** do nível 2, porque é dado
clínico (seção 15: evitar retenção excessiva). Fica guardado:

- funcionalidade, modelo e versão, quem pediu e quando;
- o resumo SHA-256 e o tamanho do que foi ao modelo;
- o paciente e, no resumo, os identificadores dos registros usados como fonte (nunca o
  conteúdo);
- a decisão do médico: usado ou descartado.

O texto aceito vive só onde deve: no rascunho do registro, que o médico salva e assina. O
administrador vê o uso de todos, sem texto, como no nível 1.

## Proteção contra instruções escondidas (_prompt injection_)

As frases vão ao modelo dentro do bloco de dados (`<<<DADOS … DADOS>>>`), tratadas como
informação. Mesmo que uma anotação ou um registro traga "ignore as instruções e escreva…", o
modelo só consegue devolver códigos, e o texto mostrado é sempre a frase original.

## Fora deste passo (pendente)

- **Transcrição de consultas** (áudio para texto) e **extração de exames** (PDF ou imagem)
  precisam de um serviço de transcrição ou de leitura de documentos. Nenhum foi contratado. O
  gateway já tem lugar para esses adaptadores; a gravação de áudio também exige consentimento
  do paciente e o prazo de descarte da seção 10 da arquitetura.
- **Reescrever** o texto (por exemplo, transformar tópicos em frases) exigiria que a IA
  escrevesse texto clínico novo. Isso fica para quando houver um modelo real, avaliação de
  risco e conferência de que nada foi inventado.
- **Nível 3** (apoio clínico) só depois de avaliação de risco e enquadramento regulatório
  (incluindo a RDC da Anvisa sobre software como dispositivo médico, quando aplicável).

## Rotas

| Método e caminho                   | Corpo                   | Resposta                       |
| ---------------------------------- | ----------------------- | ------------------------------ |
| `POST /ai/clinical/record-draft`   | `{ patientId, notes }`  | `RecordDraftSuggestionDto`     |
| `POST /ai/clinical/record-summary` | `{ patientId }`         | `RecordSummarySuggestionDto`   |
| `POST /ai/requests/:id/decision`   | `{ decision, edited? }` | `AiRequestDto` (só quem pediu) |
| `GET /ai/requests`                 | —                       | histórico do próprio médico    |

Erros: 403 `FORBIDDEN` (perfil ou vínculo), 403 `AI_FEATURE_DISABLED` (interruptor desligado),
404 (paciente), 400 (anotações vazias ou longas demais), 422 (mais de 60 frases), 502 `AI_INVALID_OUTPUT`.

Decisão registrada no [ADR 0030](../adr/0030-ia-nivel-2-so-reorganiza-frases.md).
