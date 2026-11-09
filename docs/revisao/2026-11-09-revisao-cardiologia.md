# Revisão de segurança e de código: ficha, evolução e gráficos da cardiologia

Escopo: PRs #49 (ficha), #50 (evolução) e #51 (gráficos). Data: 2026-11-09. Revisão interna, não substitui validação independente.

## Conferido sem problema

- **Autorização**: `GET patients/:id/cardiology-trends` exige acesso ao paciente, permissão de ver registro clínico e checagem por ficha via `@crm/policy`; fichas sensíveis de outro autor ficam de fora e só entram na contagem `withheld`. Testes de permitido e negado existem em `apps/api/test/records.test.ts`.
- **Validação**: a ficha é validada no backend (Zod estrito, faixas, diastólica < sistólica) e só vale em registro criado com o formulário de cardiologia (`assertFormContent` em criar, retificar, adendo e salvar).
- **Retificação**: o original passa a `rectified` e sai da evolução; só fichas `signed` entram.
- **Saída na tela**: React escapa todo texto; o SVG não usa `dangerouslySetInnerHTML`.
- **Cópia FHIR**: a ficha entra só como narrativa, com os mesmos textos da tela.

## Corrigido neste PR

1. **Número inválido guardava o valor anterior.** Ao digitar, por exemplo, `5a` em FEVE depois de `5`, o campo mostrava `5a` mas a ficha guardava `5`. Agora texto que não é número esvazia o campo na ficha e aparece o aviso "Não é um número; este campo não será salvo." (`aria-invalid` e `aria-describedby`). A leitura do número foi para `parseNumberInput` em `@crm/shared`, com teste.
2. **Limite de 500 fichas cortava as mais recentes.** A consulta ordenava da mais antiga para a mais nova e parava em 500. Agora pega as 500 mais recentes e devolve em ordem cronológica.

## Fica para a fila


