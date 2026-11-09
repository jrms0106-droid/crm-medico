# ADR 0041: impressão da evolução da cardiologia

- **Status:** aceito (2026-11-09, item da fila automática)
- **Contexto:** A evolução da cardiologia ([ADR 0038](0038-evolucao-da-ficha-de-cardiologia.md), [0039](0039-graficos-da-evolucao-da-cardiologia.md)) só existe na tela. O médico quer levar a tabela e os gráficos em papel ou PDF.
- **Decisão:**
  - Botão **Imprimir evolução** no painel. Ele usa a impressão do navegador (que também salva em PDF); não há rota nova, geração de arquivo no servidor nem biblioteca.
  - A folha leva um cabeçalho com o nome exibido do paciente, a data de nascimento, a data e hora da impressão e quem imprimiu, depois os gráficos e a tabela. Não leva CPF, telefone, endereço nem a coluna "Registro" (os botões Abrir).
  - O CSS de impressão (`@media print`, ativo só enquanto o corpo da página tem a classe `print-trend`) mostra apenas o painel, em preto sobre branco, mesmo no tema escuro. O restante da página fica sem altura, para não gerar folhas em branco.
  - Os dados impressos são os mesmos que a rota `cardiology-trends` já mandou para a tela, com a mesma autorização; imprimir não dá acesso a nada novo.
- **Motivo:** Resolve o pedido sem custo e sem superfície nova de ataque. Quem salva em PDF escolhe onde guardar, como já faz com qualquer página.
- **Alternativas descartadas:** gerar PDF no servidor (dependência e rota nova, com risco de vazar dado em arquivo temporário); imprimir a página inteira (mostra menus, linha do tempo e dados que ninguém pediu).
- **Riscos:** Uma folha impressa sai do controle do sistema. A impressão acontece no navegador e **não é registrada na trilha de auditoria**; a leitura dos dados na tela já é. O rodapé do cabeçalho identifica quem imprimiu. Dado real de paciente impresso é assunto da política de proteção de dados, não deste código.
- **Revisar quando:** O responsável pedir registro de impressão na auditoria, marca d'água ou modelo de laudo.
