# ADR 0017: Telas com navegação simples por endereço (#) e testes ponta a ponta com Playwright

- **Status:** aceito (2026-10-19, Etapa 7)
- **Decisão:**
  - A navegação do aplicativo web usa o trecho `#` do endereço (`#/pacientes/<id>`), com um componente próprio de poucas linhas, sem biblioteca de rotas.
  - As chamadas à API passam por um único cliente (`apps/web/src/api.ts`), que envia o token CSRF, traduz os erros para a mensagem em português e volta ao login quando a sessão expira.
  - Os fluxos principais por perfil são testados no navegador com Playwright, contra a API e o aplicativo compilados e um banco de teste recriado com dados fictícios. O CI roda esses testes em todo PR.
- **Motivo:** Seis telas não justificam mais uma dependência, e a navegação por `#` funciona no aplicativo instalável sem configuração de servidor. Playwright é o padrão do mercado para testes no navegador e já estava previsto no plano.
- **Alternativas descartadas:** React Router ou TanStack Router (mais uma dependência sem ganho agora); Cypress (mais pesado e mais lento no CI).
- **Consequências:** O CI fica alguns minutos mais lento (instala o Chromium). Se as telas crescerem muito, a troca por uma biblioteca de rotas fica contida em `router.ts` e `shell.tsx`.
- **Revisar quando:** Houver muitas telas aninhadas, carregamento por partes ou necessidade de endereços sem `#`.
