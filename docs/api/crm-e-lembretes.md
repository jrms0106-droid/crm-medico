# CRM e lembretes de consulta

Regras definidas antes da implementação. Primeira parte da fase CRM/WhatsApp (escolhida em
2026-10-31): autorização do paciente e lembrete automático de consulta. **O envio é simulado:**
nenhuma mensagem sai do sistema até o responsável autorizar a contratação de um serviço de WhatsApp
autorizado (WhatsApp Business Platform ou parceiro oficial).

> Textos, prazos e base legal a validar com o encarregado de dados. O lembrete é comunicação
> sobre a consulta marcada, não marketing.

## Autorização do paciente

- Vale a **preferência de comunicação do cadastro** ([pacientes.md](pacientes.md)): o paciente
  recebe lembrete só se o canal WhatsApp estiver autorizado **e** "lembretes de consulta" estiver
  ligado. O padrão é nada autorizado.
- A secretária registra a autorização ou a recusa na ficha do paciente. Cada mudança gera uma nova
  versão do cadastro e entra na auditoria, então o histórico fica guardado sem tabela separada.
- O número usado é o primeiro telefone do paciente marcado como WhatsApp. Sem esse telefone o
  cadastro não aceita autorizar o WhatsApp.

## Lembrete de consulta (`crm.messages`)

- Uma rotina na API, a cada `REMINDERS_INTERVAL_SECONDS` (0 desliga; desligada por padrão):
  1. **Planeja:** para consultas `scheduled` ou `confirmed` que começam entre 2 e 24 horas a partir de
     agora, com autorização valendo e telefone de WhatsApp, cria um lembrete (no máximo um por
     consulta).
  2. **Envia:** para cada lembrete na fila, confere de novo se a consulta continua marcada e se a
     autorização continua valendo. Se não, cancela o lembrete com o motivo. Se sim, entrega ao
     adaptador de envio.
- Até 3 tentativas; depois disso o lembrete fica `failed` com o último erro.
- Situações: `queued` (na fila), `sent` (enviado), `failed` (falhou) e `cancelled` (cancelado).
- O texto leva o **mínimo de dados**: primeiro nome, data, hora e unidade. Não leva médico,
  especialidade nem motivo da consulta.
  > Olá, Maria. Lembrete: sua consulta é em 05/03/2026 às 14:30, na Unidade Centro. Para remarcar ou
  > cancelar, ligue para a clínica.
- O texto e o número ficam gravados como foram enviados e não mudam depois.
- Adaptador de envio: `simulated` (único, por enquanto) marca como enviado com um código
  `simulado-...` e não fala com nenhum serviço externo.

## Quem pode o quê

Recurso `communication` (dado pessoal, sem escopo de unidade):

| Ação                                              | Médico | Secretária | Administrador |
| ------------------------------------------------- | ------ | ---------- | ------------- |
| Ver os lembretes (`view`)                         | —      | sim        | —             |
| Cancelar um lembrete na fila (`edit`, com motivo) | —      | sim        | —             |

Registrar a autorização é editar o cadastro (`patient_registration`), como já era.

A lista geral mostra só lembretes de consultas das unidades da secretária.

## Endpoints (`/api/v1`, sessão `active`)

| Método e rota                           | O que faz                                    |
| --------------------------------------- | -------------------------------------------- |
| `PATCH /patients/:id` (`communication`) | registra autorização ou recusa no cadastro   |
| `GET /crm/messages`                     | lembretes (`status` e `patientId` opcionais) |
| `POST /crm/messages/:id/cancel`         | cancela um lembrete na fila `{ reason }`     |

Mudar a autorização e cancelar lembrete ficam na auditoria. A exportação dos dados do paciente
([direitos-do-titular.md](direitos-do-titular.md)) inclui os lembretes com o texto enviado.
