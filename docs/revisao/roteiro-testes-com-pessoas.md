# Roteiro de testes com pessoas: leitor de tela, teclado, zoom e contraste

Este roteiro cobre a pendência 5 da [revisão geral](2026-11-01-revisao-geral.md). Ele cobre o
que a verificação automática (axe-core e o teste só pelo teclado em `e2e/keyboard.spec.ts`)
não consegue julgar: se uma pessoa que usa leitor de tela ou só o teclado **consegue de fato
fazer o trabalho** no CRM.

> **Só dados fictícios.** O teste roda no ambiente de desenvolvimento, com a clínica fictícia
> criada pelo `npm run db:seed`. Nunca digite nome, CPF, telefone ou dado clínico de pessoa real,
> nem os de quem está testando. O MVP não é apto a uso clínico real.
>
> Este roteiro não é auditoria nem certificação de acessibilidade. Ele junta evidências para
> corrigir problemas. Uma avaliação formal (por exemplo, por especialista em acessibilidade)
> continua recomendada antes do uso real.

## 1. Quem testa

- **De preferência**, pelo menos uma pessoa que usa leitor de tela no dia a dia e uma que
  navega só pelo teclado (por exemplo, por limitação motora). Elas encontram problemas que quem
  enxerga e usa mouse não percebe.
- **Também ajuda**: alguém da recepção e alguém da área médica da clínica, para dizer se o fluxo
  faz sentido no trabalho real, usando só os dados fictícios.
- Uma pessoa **acompanha e anota**, sem ajudar a pessoa que testa, a não ser que ela fique presa
  (aí anota "não conseguiu" e ajuda a seguir para a próxima tarefa).
- Cada sessão leva de 45 a 90 minutos. Não é preciso fazer todas as tarefas numa sessão só.

## 2. Preparação

### Ambiente

Quem cuida da parte técnica sobe o sistema seguindo o [README](../../README.md), na seção
"Como rodar no seu computador": `npm run db:migrate`, `npm run db:seed`, `npm run build` e `npm run dev`. O
endereço do aplicativo é `http://localhost:5173`. Antes de cada sessão, rode o `npm run db:seed`
de novo para começar com os dados limpos.

### Contas fictícias

Senha de todas: `senha-de-desenvolvimento` (só para desenvolvimento).

| Perfil        | E-mail                             | Observação                                                                                               |
| ------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Secretária    | `secretaria@clinica-ficticia.test` | no primeiro acesso cadastra a verificação em duas etapas, como o médico                                  |
| Médico        | `medico@clinica-ficticia.test`     | no primeiro acesso cadastra a verificação em duas etapas num aplicativo autenticador do celular do teste |
| Administrador | `admin@clinica-ficticia.test`      | igual ao médico                                                                                          |

A verificação em duas etapas mostra um código QR. **Anote como a pessoa com leitor de tela
lida com esse passo**: a tela também mostra a chave em texto para digitar no aplicativo. Se
ela não conseguir, isso é um achado importante.

### Combinações de leitor de tela e navegador

Teste pelo menos as duas primeiras, que são as mais usadas no Brasil:

| Prioridade | Leitor de tela            | Navegador         | Aparelho           |
| ---------- | ------------------------- | ----------------- | ------------------ |
| 1          | NVDA (gratuito)           | Chrome ou Firefox | computador Windows |
| 2          | TalkBack (vem no Android) | Chrome            | celular Android    |
| 3          | VoiceOver (vem no Mac)    | Safari            | Mac                |
| 4          | VoiceOver (vem no iPhone) | Safari            | iPhone             |

No teste **só com teclado**, use o computador sem mouse e sem leitor de tela, com o mouse
desligado ou longe da mão.

### Teclas básicas (computador)

| Tecla                 | O que faz                                                    |
| --------------------- | ------------------------------------------------------------ |
| `Tab` / `Shift+Tab`   | vai para o próximo / volta para o anterior item clicável     |
| `Enter`               | aciona um link ou botão; envia um formulário                 |
| `Espaço`              | marca uma caixa de seleção; aciona um botão                  |
| Setas                 | escolhem entre opções de um grupo (por exemplo, os horários) |
| `Esc`                 | fecha listas abertas                                         |
| NVDA: `H` / `D` / `T` | pula para o próximo título / região / tabela                 |
| NVDA: `Insert+F7`     | lista de links, títulos e campos da página                   |

## 3. Como anotar

Para cada tarefa, quem acompanha preenche uma linha da [folha de resultados](#7-folha-de-resultados):

- **Resultado:** `Conseguiu`, `Conseguiu com dificuldade` ou `Não conseguiu`.
- **O que aconteceu:** em palavras simples, por exemplo "o leitor disse só 'botão' sem nome" ou
  "o foco sumiu depois de salvar".
- **Gravidade:**
  - `Impede`: a pessoa não termina a tarefa.
  - `Atrapalha`: termina, mas com esforço, adivinhação ou ajuda.
  - `Detalhe`: incômodo pequeno.
- Combinação usada (leitor de tela, navegador, aparelho) e a data.

Não anote dado pessoal de quem testou além do primeiro nome ou um apelido, se a pessoa quiser.

## 4. Tarefas

Em cada tarefa, "O que deve acontecer" é o comportamento esperado. Qualquer diferença é um
achado. Vale para todas as tarefas:

- todo campo, botão e link é anunciado com um nome que faz sentido;
- dá para chegar em tudo com `Tab`, e o foco **sempre aparece** na tela (um contorno visível);
- o foco nunca fica preso num lugar de onde não dá para sair com `Tab` ou `Shift+Tab`;
- mensagens de erro e de sucesso são lidas sem a pessoa precisar procurar.

### Geral (qualquer perfil)

| Nº  | Tarefa                   | Passos                                                             | O que deve acontecer                                                                                                 |
| --- | ------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| G1  | Entrar com senha errada  | Digitar o e-mail da secretária e uma senha errada, apertar `Enter` | O erro é lido na hora, sem dizer se o e-mail existe                                                                  |
| G2  | Entrar                   | Repetir com a senha certa                                          | A tela inicial abre, e o título da página muda (o leitor anuncia a nova página)                                      |
| G3  | Pular o menu             | Na tela inicial, apertar `Tab` uma vez                             | O primeiro item é "Pular para o conteúdo"; com `Enter`, o foco vai para o conteúdo principal                         |
| G4  | Andar pelo menu          | Ir pelo menu até "Pacientes" e abrir                               | O menu é anunciado como "Menu principal"; ao abrir a tela, o foco vai para o conteúdo, não volta para o topo do menu |
| G5  | Faixa de dados fictícios | Ler o topo da página                                               | A faixa avisando que o ambiente é de dados fictícios é lida                                                          |
| G6  | Sair                     | Achar e acionar "Sair"                                             | Volta para a tela de entrada                                                                                         |

### Secretária

| Nº  | Tarefa                         | Passos                                                                                                                                                                                             | O que deve acontecer                                                                                                                                     |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Cadastrar paciente             | Em "Pacientes", acionar "Novo paciente". Preencher nome completo `Joana Exemplo Teste`, nascimento `12/04/1985`, telefone `11987654321`, marcar "Este telefone tem WhatsApp" e acionar "Cadastrar" | Cada campo é anunciado com o nome e se é obrigatório; a ficha da paciente abre com o nome como título                                                    |
| S2  | Erro no cadastro               | Repetir S1 deixando o nome vazio e acionar "Cadastrar"                                                                                                                                             | O erro é lido e diz qual campo corrigir                                                                                                                  |
| S3  | Aviso de possível duplicidade  | Cadastrar de novo `Joana Exemplo Teste` com o mesmo nascimento                                                                                                                                     | O aviso de possível duplicidade é lido, e fica claro que é preciso confirmar de novo para cadastrar                                                      |
| S4  | Marcar consulta                | Na ficha da paciente, acionar "Agendar consulta", escolher o primeiro horário livre (com as setas) e acionar "Agendar"                                                                             | Os horários são anunciados como um grupo de opções com a hora; a mensagem "Consulta marcada…" é lida                                                     |
| S5  | Confirmar e registrar chegada  | Na agenda do dia, achar a linha da paciente, acionar "Confirmar" e depois "Registrar chegada"                                                                                                      | Na tabela, dá para saber de quem é cada linha e a situação; a mudança de situação é perceptível                                                          |
| S6  | Cobrar e receber               | Na mesma linha, acionar "Cobrar", criar a cobrança, abrir e registrar um pagamento em dinheiro                                                                                                     | Os valores em reais são lidos de forma compreensível; a situação da cobrança muda e isso é anunciado ou fácil de achar                                   |
| S7  | Pedido de direito do paciente  | Na ficha da paciente, registrar um pedido de acesso aos dados, depois em "Direitos do paciente" responder como atendido                                                                            | O prazo e o aviso de vencido (quando houver) são lidos; antes de responder fica claro que não dá para desfazer                                           |
| S8  | Importar planilha com erro     | Em "Importar pacientes", baixar o modelo, criar um CSV com uma linha boa e uma sem nome, escolher o arquivo e conferir                                                                             | O resultado de cada linha (pronta ou com erro, e qual coluna) é lido; só depois de "Importar" algo é gravado                                             |
| S9  | Assistente com sinal de alerta | Em "Assistente (IA)", colar `Estou com dor no peito forte desde cedo` em "Mensagem do paciente" e acionar "Classificar"                                                                            | O aviso fixo para orientar o pronto-socorro ou o 192 é lido sozinho, assim que aparece; fica claro que a resposta sugerida é rascunho do modelo simulado |

### Médico

| Nº  | Tarefa              | Passos                                                                                                                         | O que deve acontecer                                                                                         |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| M1  | Entrar com código   | Entrar com senha e o código de 6 dígitos do aplicativo autenticador                                                            | O campo do código é anunciado; código errado gera erro lido na hora                                          |
| M2  | Iniciar atendimento | Na agenda, achar a paciente que chegou (de S5) e acionar "Iniciar atendimento"                                                 | O prontuário abre com o título "Prontuário de Joana Exemplo Teste" e o vínculo "Atendimento iniciado" é lido |
| M3  | Escrever registro   | Acionar "Novo registro", preencher motivo da consulta, anamnese e conduta com textos fictícios                                 | O salvamento automático do rascunho é anunciado sem tirar o foco do campo em que a pessoa escreve            |
| M4  | Finalizar e assinar | Acionar "Finalizar", depois "Assinar", digitar senha e código e acionar "Confirmar e assinar"                                  | Fica claro o que a assinatura faz; o resultado ("Conteúdo íntegro." e a situação "Assinado") é lido          |
| M5  | Receita simples     | Em "Documentos", acionar "Receita simples", preencher o medicamento 1 e a posologia 1, salvar o rascunho, assinar, abrir o PDF | O aviso de que a receita simples não serve para controlados nem antimicrobianos é lido; o PDF abre           |
| M6  | Cópia do prontuário | Acionar "Encerrar atendimento" e depois "Cópia do prontuário"                                                                  | A mensagem dizendo quantos registros foram incluídos é lida                                                  |

### Administrador

| Nº  | Tarefa             | Passos                                                                                         | O que deve acontecer                                                                  |
| --- | ------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A1  | Criar usuário      | Em "Configurações", criar uma secretária fictícia, confirmando a identidade com senha e código | A senha temporária, mostrada uma única vez, é lida e dá para copiar                   |
| A2  | Horários da agenda | Editar as faixas de atendimento de um dia da semana e salvar                                   | Cada faixa diz o dia e o horário; "Horários salvos." é lido                           |
| A3  | Estornar pagamento | Em "Financeiro", abrir a cobrança de S6 e estornar o pagamento com motivo                      | O pedido de senha e código aparece no lugar certo, e o resultado é lido               |
| A4  | Auditoria          | Em "Auditoria", filtrar por resultado e verificar a trilha                                     | A tabela de eventos é navegável por linha e coluna; o resultado da verificação é lido |

## 5. Telas longas só pelo teclado

Sem leitor de tela e sem mouse, refaça **M2 a M5** (prontuário) e **S6 e A3** (financeiro)
prestando atenção em:

1. **Ordem do foco:** o `Tab` segue a ordem em que as coisas aparecem na tela, de cima para
   baixo e da esquerda para a direita.
2. **Foco visível:** em nenhum momento você perde de vista onde está o foco, mesmo depois de
   rolar a página.
3. **Depois de uma ação** (salvar, assinar, registrar pagamento), o foco fica num lugar que faz
   sentido, e não volta sozinho para o topo da página.
4. **Quantidade de `Tab`:** anote se é preciso apertar `Tab` muitas vezes (mais de 20) para
   chegar numa ação frequente. Isso é `Atrapalha`.

Parte disso já é conferida automaticamente: o teste `e2e/keyboard.spec.ts` faz a tarefa S1, a
S4 e a confirmação da S5 só com o teclado e confere que o foco aparece. O teste com pessoas
continua necessário, porque ele julga se o caminho é razoável, e não só possível.

## 6. Zoom e contraste

### Zoom

No navegador do computador:

1. Aumente o zoom para **200%** (`Ctrl` e `+`) e refaça G4, S1 e S4. Todo o texto continua
   visível, sem cortar, e nada fica por cima de outra coisa.
2. Aumente para **400%** (equivale a uma tela de celular estreita). A página rola só para cima e
   para baixo, sem precisar rolar para o lado para ler um texto. Tabelas largas podem rolar
   para o lado, mas só dentro da própria tabela.

No celular, aumente a fonte do sistema para o máximo e abra a agenda e a ficha do paciente.

### Contraste com as cores reais da clínica

As cores atuais passam na verificação automática (axe, nível AA). Se a clínica pedir as cores
da própria marca, **cada combinação precisa ser conferida antes de entrar no sistema**:

| O que                                                 | Contraste mínimo (WCAG 2.1 AA) |
| ----------------------------------------------------- | ------------------------------ |
| Texto comum sobre o fundo                             | 4,5 : 1                        |
| Texto grande (a partir de 24 px, ou 19 px em negrito) | 3 : 1                          |
| Borda de campo, ícone e contorno do foco              | 3 : 1                          |

Como conferir: a ferramenta de contraste das ferramentas de desenvolvedor do Chrome ou do
Firefox (gratuitas), ou um verificador on-line gratuito de contraste, informando a cor do
texto e a do fundo. Anote cada par de cores e o resultado na folha.

Além do contraste, a informação nunca pode depender só da cor. Por exemplo, a situação de uma
consulta aparece escrita, e não só como uma bolinha colorida.

## 7. Folha de resultados

Copie esta tabela (numa planilha ou num documento) e preencha uma linha por tarefa. Depois,
mande a folha na conversa do projeto para os problemas virarem correções e, quando der, testes
automáticos.

| Data | Nº da tarefa | Combinação (leitor, navegador, aparelho) | Resultado | O que aconteceu | Gravidade |
| ---- | ------------ | ---------------------------------------- | --------- | --------------- | --------- |
|      |              |                                          |           |                 |           |
