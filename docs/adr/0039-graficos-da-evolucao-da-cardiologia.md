# ADR 0039: gráficos da evolução da cardiologia

- **Status:** aceito (2026-11-09, escolha do responsável)
- **Contexto:** O painel **Evolução da cardiologia** ([ADR 0038](0038-evolucao-da-ficha-de-cardiologia.md)) mostra os valores numa tabela. Para ver tendência no consultório, o responsável escolheu acrescentar gráficos.
- **Decisão:**
  - A rota `GET /patients/:id/cardiology-trends` passa a mandar, em cada linha, também os números (`numbers`): PA sistólica e diastólica, LDL e FEVE. O acesso não muda.
  - A tela desenha um gráfico de linha para cada medida: pressão arterial (sistólica e diastólica no mesmo gráfico, mesma unidade), LDL e FEVE. Cada gráfico tem o próprio eixo vertical; nunca dois eixos no mesmo gráfico.
  - O gráfico só aparece com **dois ou mais** valores daquela medida. Com um só, a tabela basta.
  - Desenho em SVG feito no próprio código, sem biblioteca nova. O eixo horizontal é proporcional às datas; fichas do mesmo dia ficam lado a lado, na ordem.
  - As duas cores das séries (azul e laranja, com versões próprias para o tema escuro) passaram no validador de paleta para daltonismo e contraste. A PA tem legenda e rótulo direto no último ponto, então a série não depende só da cor.
  - Passar o mouse num ponto mostra data, valor e autor abaixo do gráfico. Para teclado e leitor de tela, cada gráfico é uma imagem com descrição em texto (primeiro e último valor de cada série) e a tabela continua logo abaixo com todos os valores.
- **Motivo:** Gráficos pequenos e separados por medida são fáceis de ler e evitam comparar grandezas diferentes no mesmo eixo. Sem biblioteca, não há dependência nova nem custo.
- **Alternativas descartadas:** biblioteca de gráficos (dependência a mais para três linhas); todos os valores num gráfico com dois eixos (engana a leitura); faixas de referência ou metas no gráfico (seria interpretação clínica sem validação).
- **Consequências:** O gráfico não marca valor alterado nem meta. As escalas se ajustam aos valores do paciente, então a inclinação de uma linha não deve ser comparada entre pacientes.
- **Revisar quando:** O responsável pedir outras medidas, metas (por exemplo, LDL-alvo) ou impressão dos gráficos.
