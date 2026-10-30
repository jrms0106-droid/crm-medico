# Telas do sistema (Etapa 7)

Interface web/PWA das etapas anteriores. Toda regra de acesso continua no backend: o menu só esconde o que o perfil não usa, e a API nega por padrão mesmo que alguém digite o endereço.

> **Não apto a uso clínico real.** O formulário do prontuário é genérico e a assinatura é interna, ambos pendentes de validação médica e jurídica. A faixa amarela no topo lembra que o ambiente é de dados fictícios.

## Menus por perfil

| Tela          | Médico                                  | Secretária                         | Administrador  |
| ------------- | --------------------------------------- | ---------------------------------- | -------------- |
| Início        | sim                                     | sim                                | sim            |
| Pacientes     | sim                                     | sim                                | —              |
| Agenda        | a própria                               | todas as agendas das suas unidades | —              |
| Prontuário    | sim (a partir do paciente ou da agenda) | —                                  | —              |
| Financeiro    | —                                       | cobranças das suas unidades        | ver e estornar |
| Profissionais | ver                                     | ver                                | ver            |
| Auditoria     | —                                       | —                                  | sim            |
| Configurações | —                                       | —                                  | sim (consulta) |

## O que cada tela faz

- **Pacientes:** busca por nome, CPF ou telefone; cadastro rápido (nome, nome social, nascimento, CPF opcional, telefone). Se a API avisar possível duplicidade, a tela mostra o aviso e pede uma segunda confirmação. A ficha mostra o CPF mascarado.
- **Agenda:** escolha da agenda e do dia; lista das consultas com a situação. A secretária confirma, registra a chegada e cancela (com motivo), e marca consultas escolhendo o paciente e um horário livre. O médico vê só a própria agenda e inicia o atendimento quando o paciente chegou.
- **Prontuário:** mostra o estado do vínculo e a linha do tempo. Com atendimento iniciado ou acompanhamento, o médico cria registros. O rascunho salva sozinho três segundos depois de parar de digitar; se outra janela salvou antes, a tela avisa e mantém o texto. Finalizar, assinar (com senha e código), reabrir, retificar e adendar seguem [prontuario.md](api/prontuario.md). Registro sensível de outro médico só abre com justificativa.
- **Documentos (dentro do prontuário):** lista os documentos do paciente que o médico pode ver. Com atendimento iniciado ou acompanhamento, ele cria receita simples, atestado, pedido de exames, encaminhamento ou relatório. O rascunho é gravado quando ele pede, porque o conteúdo precisa estar completo; depois ele edita, assina (com senha e código), abre o PDF ou descarta. O autor cancela o assinado com motivo. As regras estão em [documentos.md](api/documentos.md). A tela avisa que a assinatura é interna, sem ICP-Brasil, e que a receita simples não serve para controlados nem antimicrobianos.
- **Financeiro:** escolha da unidade e do período; resumo (cobrado, recebido por forma, estornado e em aberto) e lista das cobranças com filtro por situação. A secretária cobra uma consulta pelo botão **Cobrar** da agenda (paciente que chegou) ou um serviço avulso buscando o paciente, escolhendo um item da tabela de preços ou digitando descrição e valor, com desconto opcional. Ao abrir a cobrança, ela registra pagamentos (inteiros ou em partes) e cancela com motivo se não houver pagamento. Cada formulário de pagamento leva uma chave de idempotência: se a resposta se perder e ela clicar de novo, não entra pagamento em dobro. O administrador vê tudo e estorna um pagamento com motivo e senha (e código). O médico não vê esta tela. As regras estão em [financeiro.md](api/financeiro.md).
- **Auditoria:** lista de eventos com filtro por resultado, verificação da trilha encadeada ([auditoria.md](api/auditoria.md)) e fila de revisão dos acessos emergenciais.
- **Configurações:** o administrador cria e edita usuários (perfis e unidades), redefine acesso (mostra a senha temporária uma única vez), desativa e reativa contas; cria e desativa unidades e especialidades; cria fichas profissionais (CRM, UF, especialidade e RQE) para usuários com perfil Médico; cria agendas por unidade e edita as faixas de atendimento por dia da semana; mantém a tabela de preços do particular (criar, mudar valor, desativar). Mudanças de acesso pedem a senha (e o código) de novo, como a API exige. Para configurar as agendas de uma unidade, o administrador precisa estar vinculado a ela.

## Dados no aparelho

Nenhum dado de paciente é guardado no navegador: o token de proteção (CSRF) fica só na memória da página e o aplicativo instalável guarda em cache apenas a "casca" (HTML, JS, CSS). O rascunho do prontuário fica no servidor, não no aparelho.

## Testes ponta a ponta

`npm run e2e` sobe a API e o aplicativo compilados (`npm run build` antes) contra o banco de **teste**, recria dados fictícios (`e2e/seed.ts`) e roda no Chromium:

1. os menus mudam conforme o perfil, e o endereço de uma área de outro perfil não abre;
2. a secretária cadastra um paciente, marca a consulta, confirma e registra a chegada;
3. o médico inicia o atendimento, escreve o registro, finaliza, assina com senha e código e vê "Conteúdo íntegro"; depois emite uma receita simples, assina, confere que o PDF abre e encerra o atendimento;
4. o administrador verifica a trilha de auditoria;
5. o administrador cadastra um médico (confirmando a identidade), cria a ficha profissional e a agenda com uma faixa de horário;
6. o administrador cria um item na tabela de preços; a secretária cobra a consulta pela agenda com desconto e recebe em duas partes (Pix e dinheiro) até quitar; o administrador estorna um pagamento com motivo e confirmação de identidade e o saldo volta; o médico não abre o financeiro.

No contêiner de desenvolvimento, use o Chromium já instalado: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e`. Com `E2E_SCREENSHOTS=<pasta>`, o teste guarda imagens das telas.

Limite conhecido: a agenda de teste é aberta o dia todo, mas perto da meia-noite pode não haver horário livre no mesmo dia, e o teste da secretária falharia.
