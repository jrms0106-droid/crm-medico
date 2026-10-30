# Financeiro particular

Regras definidas antes da implementação (seção 30 do Prompt Mestre). Atende à seção 3.6 do Prompt Mestre, ao módulo `billing` de [03-arquitetura.md](../planejamento/03-arquitetura.md) e à fase de financeiro do plano ([04-plano-do-mvp.md](../planejamento/04-plano-do-mvp.md)). Escopo escolhido pelo responsável em 2026-10-30: **só atendimento particular, sem convênios**.

> **Sem integração de pagamento e sem nota fiscal.** O sistema registra cobranças e os pagamentos recebidos na recepção (dinheiro, Pix, cartão na maquininha). Não cobra cartão, não gera Pix, não guarda dados de cartão e não emite nota fiscal nem recibo com valor fiscal. Integração com meio de pagamento ou emissão fiscal exige contratação e autorização.

## Tabela de preços

O administrador cadastra os itens cobrados (por exemplo, "Consulta", "Retorno") com nome e valor. Um item pode ser desativado, mas não apagado. Mudar o valor de um item não muda as cobranças já feitas, porque a cobrança guarda o valor do momento.

## Cobrança

Uma cobrança (`billing.charges`) é o que o paciente deve por um atendimento ou serviço:

- paciente, unidade e, quando houver, a consulta da agenda;
- descrição (até 200 caracteres) e, se veio da tabela, o item de origem;
- valor e desconto em centavos (valor de 1 centavo a R$ 100.000,00; desconto entre zero e o valor);
- quem criou e quando.

Regras:

- Uma consulta tem no máximo **uma cobrança não cancelada**. A consulta precisa ser da mesma unidade e do mesmo paciente.
- O valor e o desconto não mudam depois de criados. Para corrigir, cancela-se e cria-se outra.
- **Cancelar** exige motivo (3 a 200 caracteres) e só é possível sem pagamento confirmado. Se houver pagamento, primeiro o administrador estorna.
- A situação da cobrança é calculada: `open` (em aberto), `partially_paid` (pago em parte), `paid` (quitada) ou `cancelled` (cancelada). O saldo é valor − desconto − pagamentos confirmados.
- Nada é apagado: o banco recusa `DELETE` em cobranças e pagamentos.

## Pagamento

Cada pagamento (`billing.payments`) registra forma, valor, data e hora do recebimento e quem recebeu.

- Formas: `cash` (dinheiro), `pix`, `debit_card` (cartão de débito), `credit_card` (cartão de crédito), `other` (outra).
- O valor não pode passar do saldo. Pagamento em partes é aceito.
- A data do recebimento é a hora do registro, ou uma hora anterior informada (até 30 dias para trás, nunca no futuro).
- **Contra pagamento em dobro:** o registro exige o cabeçalho `Idempotency-Key` (8 a 100 caracteres, gerado pela tela). Repetir o pedido com a mesma chave devolve o mesmo pagamento, sem registrar outro. A mesma chave com dados diferentes é recusada (409 `IDEMPOTENCY_CONFLICT`). Além disso, a cobrança é travada durante o registro, para dois pagamentos simultâneos não passarem do saldo.
- O pagamento não é alterado. Se foi registrado errado, o **administrador estorna**, com motivo (3 a 200 caracteres) e **reautenticação recente**. O estorno guarda quem, quando e por quê, e o valor volta ao saldo.

## Relatório

`GET /billing/report?from=AAAA-MM-DD&to=AAAA-MM-DD&unitId=...` resume o período (no máximo 366 dias, datas no fuso da unidade ou de São Paulo):

- cobrado: quantidade de cobranças, valor bruto, descontos e valor líquido (cobranças não canceladas criadas no período);
- recebido: total e por forma de pagamento (pagamentos confirmados recebidos no período);
- estornado: total estornado no período;
- em aberto: saldo de todas as cobranças não quitadas e não canceladas criadas até o fim do período (inadimplência simples).

São só valores agregados, sem dado clínico.

## Quem pode o quê

| Recurso e ação                                   | Médico | Secretária        | Administrador           |
| ------------------------------------------------ | ------ | ----------------- | ----------------------- |
| Tabela de preços (`price_item`): ver             | —      | sim               | sim                     |
| Tabela de preços: criar e editar                 | —      | —                 | sim                     |
| Cobranças (`charge`): ver                        | —      | das suas unidades | todas                   |
| Cobranças: criar, cancelar e registrar pagamento | —      | das suas unidades | —                       |
| Pagamento: estornar (`correct`)                  | —      | —                 | sim, com reautenticação |
| Relatório (`financial_report`): ver              | —      | das suas unidades | todas                   |

- O médico não acessa o financeiro nesta fase. Ver o próprio faturamento fica para depois, como relatório agregado.
- Toda decisão, permitida ou negada, vai para a auditoria, como nas outras áreas.

## Endpoints (`/api/v1`, sessão `active`)

| Método e rota                | O que faz                                                                   |
| ---------------------------- | --------------------------------------------------------------------------- |
| `GET /billing/prices`        | itens da tabela (`includeInactive=true` para ver os desativados)            |
| `POST /billing/prices`       | cria item `{ name, amountCents }`                                           |
| `PATCH /billing/prices/:id`  | altera `{ name?, amountCents?, active? }`                                   |
| `POST /charges`              | cria cobrança                                                               |
| `GET /charges`               | lista por `unitId` (obrigatório), `status`, `patientId`, período            |
| `GET /charges/:id`           | cobrança com pagamentos e saldo                                             |
| `POST /charges/:id/cancel`   | cancela `{ reason }`                                                        |
| `POST /charges/:id/payments` | registra pagamento `{ method, amountCents, paidAt? }` com `Idempotency-Key` |
| `POST /payments/:id/reverse` | estorna `{ reason }` (administrador, reautenticação)                        |
| `GET /billing/report`        | resumo do período                                                           |

Toda rota tem teste de acesso permitido e negado (`apps/api/test/billing.test.ts`).

## Limites conhecidos

- Sem convênios, guias, glosas ou faturamento por operadora.
- Sem integração com maquininha, Pix dinâmico ou gateway; sem conciliação bancária automática.
- Sem recibo, nota fiscal ou integração contábil.
- Sem parcelamento próprio: a parcela do cartão é da maquininha, e o sistema registra o valor recebido.
