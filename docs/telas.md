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
| Profissionais | ver                                     | ver                                | ver            |
| Auditoria     | —                                       | —                                  | sim            |
| Configurações | —                                       | —                                  | sim (consulta) |

## O que cada tela faz

- **Pacientes:** busca por nome, CPF ou telefone; cadastro rápido (nome, nome social, nascimento, CPF opcional, telefone). Se a API avisar possível duplicidade, a tela mostra o aviso e pede uma segunda confirmação. A ficha mostra o CPF mascarado.
- **Agenda:** escolha da agenda e do dia; lista das consultas com a situação. A secretária confirma, registra a chegada e cancela (com motivo), e marca consultas escolhendo o paciente e um horário livre. O médico vê só a própria agenda e inicia o atendimento quando o paciente chegou.
- **Prontuário:** mostra o estado do vínculo e a linha do tempo. Com atendimento iniciado ou acompanhamento, o médico cria registros. O rascunho salva sozinho três segundos depois de parar de digitar; se outra janela salvou antes, a tela avisa e mantém o texto. Finalizar, assinar (com senha e código), reabrir, retificar e adendar seguem [prontuario.md](api/prontuario.md). Registro sensível de outro médico só abre com justificativa.
- **Auditoria:** lista de eventos com filtro por resultado, verificação da trilha encadeada ([auditoria.md](api/auditoria.md)) e fila de revisão dos acessos emergenciais.
- **Configurações:** consulta de unidades e usuários. Criar e alterar ainda é pela API; as telas de edição ficam para uma próxima entrega.

## Dados no aparelho

Nenhum dado de paciente é guardado no navegador: o token de proteção (CSRF) fica só na memória da página e o aplicativo instalável guarda em cache apenas a "casca" (HTML, JS, CSS). O rascunho do prontuário fica no servidor, não no aparelho.

## Testes ponta a ponta

`npm run e2e` sobe a API e o aplicativo compilados (`npm run build` antes) contra o banco de **teste**, recria dados fictícios (`e2e/seed.ts`) e roda no Chromium:

1. os menus mudam conforme o perfil, e o endereço de uma área de outro perfil não abre;
2. a secretária cadastra um paciente, marca a consulta, confirma e registra a chegada;
3. o médico inicia o atendimento, escreve o registro, finaliza, assina com senha e código, vê "Conteúdo íntegro" e encerra o atendimento;
4. o administrador verifica a trilha de auditoria.

No contêiner de desenvolvimento, use o Chromium já instalado: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e`. Com `E2E_SCREENSHOTS=<pasta>`, o teste guarda imagens das telas.

Limite conhecido: a agenda de teste é aberta o dia todo, mas perto da meia-noite pode não haver horário livre no mesmo dia, e o teste da secretária falharia.
