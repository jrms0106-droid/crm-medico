# O que depende do Jose (2026-11-11)

O plano do MVP está todo entregue e os itens abaixo são os que o Claude não pode fazer sozinho, por
exigirem autorização, contratação, dados reais ou decisão clínica ou jurídica. Enquanto eles não
andam, a fila de trabalho automática fica vazia. Nada aqui foi contratado ou enviado.

Para destravar um item, basta dizer na conversa qual deles e a decisão (ou "pode seguir com o padrão").

## Autorizar ou contratar

| Item                                                             | O que falta                                                                                                            | Onde está o material                                                                                                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hospedagem (produção)                                            | Decidir se pede cotação e a quem; contratar só com autorização por escrito                                             | [comparativo](../operacao/comparativo-de-fornecedores.md), [pedido de cotação](../operacao/pedido-de-cotacao.md), [requisitos](../operacao/requisitos-de-hospedagem.md) |
| Assinatura ICP-Brasil nos documentos                             | Escolher e contratar um provedor de certificado e assinatura (o fluxo já está pronto com assinador simulado, ADR 0046) | [documentos](../api/documentos.md)                                                                                                                                      |
| Receita pela Memed de verdade                                    | Ler a documentação oficial, obter credenciais, revisar os termos de uso dos dados                                      | [ADR 0045](../adr/0045-prescricao-memed-simulada.md)                                                                                                                    |
| Sala de teleconsulta de verdade (Google Meet)                    | Credenciais do Google e revisão de privacidade                                                                         | [ADR 0043](../adr/0043-teleconsulta-com-sala-simulada.md)                                                                                                               |
| Lembretes pelo WhatsApp de verdade                               | Contratar um serviço autorizado de envio                                                                               | [CRM e lembretes](../api/crm-e-lembretes.md)                                                                                                                            |
| IA com modelo real, transcrição de consultas e leitura de exames | Contratar o serviço; a IA nível 3 só depois das validações                                                             | [IA nível 1](../api/ia-nivel-1.md), [IA nível 2](../api/ia-nivel-2.md)                                                                                                  |

## Conferir (clínico, legal, segurança)

- Os campos e textos clínicos que o Claude escolheu com um padrão razoável estão em
  [itens a conferir](a-conferir.md). Isso inclui o termo de consentimento da teleconsulta e a
  pergunta se a retificação feita depois do atendimento encerrado deve levar a marca de
  telemedicina (hoje não leva, por ser um registro novo).
- Validação jurídica do nível de assinatura exigido no prontuário e nos documentos (hoje a assinatura é
  interna, não ICP-Brasil).
- Validação independente de conformidade, teste de invasão e testes de uso com pessoas reais. A
  [matriz de conformidade](../conformidade/matriz-de-conformidade.md) não é declaração de
  conformidade.
- Uso de qualquer dado real: o sistema só roda com dados fictícios.

## Dependabot: atualizações de versão principal

O Claude já junta sozinho as menores (minor e patch). Estas são de versão principal e esperam o
Jose: @types/node 22 para 26 (#59), TypeScript 6 para 7 (#5) e as ações do GitHub (#3, #4, #6 e #37).
Se o Jose disser "pode testar os majors", o Claude testa uma de cada vez (build, check, e2e e CI) e só
junta se tudo passar.
