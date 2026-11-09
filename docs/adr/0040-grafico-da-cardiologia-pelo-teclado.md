# ADR 0040: gráficos da cardiologia acessíveis por teclado

- **Status:** aceito (2026-11-09, item da fila automática)
- **Contexto:** Os gráficos da evolução ([ADR 0039](0039-graficos-da-evolucao-da-cardiologia.md)) mostravam data, valor e autor só ao passar o mouse. Quem usa teclado ou leitor de tela dependia da descrição geral e da tabela.
- **Decisão:**
  - Cada ponto vira um elemento focável com rótulo próprio ("Sistólica, ponto 2 de 3: 01/11/2026, 142 mmHg, Dra. Ana"). Ao receber o foco, a leitura abaixo do gráfico mostra o mesmo texto que o mouse mostra.
  - Só um ponto de cada gráfico fica na ordem de tabulação (o valor mais recente, ou o último em que o foco esteve), para o Tab não atravessar dezenas de pontos. Dentro do gráfico: setas esquerda/direita andam pela série, cima/baixo trocam de série e caem no ponto mais próximo na data, Home/End vão ao primeiro e ao último. A regra fica em `moveCursor` (`@crm/shared`), com teste.
  - O gráfico deixa de ser `role="img"` e passa a `role="group"` com o mesmo texto de descrição, mais a dica das setas. Motivo: um `img` torna os filhos apresentacionais e o axe recusa elemento focável dentro dele.
  - O foco aparece como anel tracejado na cor do texto, visível nos dois temas.
- **Motivo:** Dá ao teclado o mesmo acesso que o mouse já tinha, sem biblioteca e sem mudar a API.
- **Alternativas descartadas:** todos os pontos no Tab (muitas paradas); só a tabela (já existe, mas não substitui a leitura ponto a ponto); `role="application"` (obriga o leitor de tela a sair do modo de leitura).
- **Consequências:** Quem testa os gráficos procura `group`, não `img`. Nenhuma mudança de dados ou de permissão.
- **Revisar quando:** Entrarem outras medidas nos gráficos ou a impressão dos gráficos (próximo item da fila).
