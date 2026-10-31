# 04 — Plano do primeiro produto funcional (MVP)

Atende às seções 23, 25, 28 e 31 do Prompt Mestre (versão completa). Status: **proposta, aguardando aprovação**.

O MVP contempla **autenticação, perfis de acesso, cadastro de pacientes, agenda, prontuário básico e auditoria**. Ele **não** é apto a uso clínico real: roda só com dados fictícios e precisa das validações técnicas, clínicas, jurídicas e regulatórias antes de qualquer uso com pacientes.

Cada etapa abaixo vira um ou mais Pull Requests. Nenhuma tela é considerada pronta sem API, regra de negócio, banco e autorização integrados e testados (seção 25).

## Etapa 0 — Fundação do repositório

- **Entrega:** monorepo (`apps/api`, `apps/web`, `packages/shared`, `packages/policy`), TypeScript estrito, ESLint/Prettier, Vitest, PostgreSQL local, Prisma com primeira migração, CI no GitHub Actions, `docker-compose.yml`, `.env.example`, ADRs iniciais, script de dados fictícios.
- **Dependências:** repositório privado criado.
- **Riscos:** escolha de versões de bibliotecas; mitigado com versões travadas e auditoria no CI.
- **Critérios de aceite:** `npm run check` (tipos + lint + testes) passa localmente e no CI; `npm run dev` sobe API e web; nenhuma credencial no repositório (Gitleaks verde).

## Etapa 1 — Identidade e sessão

- **Entrega:** usuários, login com senha Argon2id, MFA TOTP, sessões no servidor, logout, expiração por inatividade e absoluta, bloqueio por tentativas, recuperação de acesso por administrador (sem e-mail real no MVP), reautenticação para ações críticas.
- **Critérios de aceite (testes automáticos):** login válido/inválido; MFA exigido e verificado; sessão expira; sessão revogada ao desativar usuário; rota protegida sem sessão → 401; CSRF bloqueado; força bruta → 429.

## Etapa 2 — Organização, perfis e motor de autorização

- **Entrega:** organização, unidade, especialidades, profissionais (CRM/UF), papéis (médico, secretária, administrador), motor `policy` com negação por padrão, auditoria de toda decisão.
- **Critérios de aceite:** matriz de testes papel × recurso × ação (visualizar, criar, editar, corrigir, assinar, exportar, compartilhar); administrador sem acesso clínico; usuário de outra unidade negado em recurso operacional da unidade alheia; manipulação de ids na URL → 404/403 auditado.

## Etapa 3 — Pacientes

- **Entrega:** cadastro completo (nome social, CPF validado, responsáveis, contato de emergência, preferências de comunicação), busca sem acento por nome/CPF/telefone, alerta de duplicidade, histórico de alterações.
- **Critérios de aceite:** CPF inválido recusado; CPF repetido bloqueado; busca encontra "José" digitando "jose"; toda alteração gera versão e evento de auditoria; secretária edita cadastro mas não vê dados clínicos.

## Etapa 4 — Agenda

- **Entrega:** agendas por profissional, regras de horário e duração, bloqueios, encaixe, retorno, cancelamento, reagendamento, lista de espera, confirmação de presença.
- **Critérios de aceite:** duas consultas sobrepostas na mesma agenda são impossíveis (barrado no banco, testado com requisições simultâneas); agendar em horário bloqueado recusado; reagendamento preserva histórico.

## Etapa 5 — Atendimento e vínculo assistencial

- **Entrega:** máquina de estados agendado → confirmado → iniciado → acompanhamento ativo → encerrado → expirado, com as permissões da tabela 5.2 de [03-arquitetura.md](03-arquitetura.md); acesso emergencial com justificativa, prazo e fila de revisão.
- **Critérios de aceite:** um teste por estado verificando o que o médico vê e não vê; agendamento não libera histórico completo; expiração revoga acesso a registros de outros autores; acesso emergencial expira sozinho e aparece na revisão.

## Etapa 6 — Prontuário básico

- **Entrega:** registros com estados rascunho/finalizado/assinado/retificado/arquivado, salvamento automático, controle de conflito, assinatura interna com reautenticação, hash e bloqueio no banco, retificação e adendo com justificativa, sensibilidade, linha do tempo do paciente. Formulário genérico (anamnese, exame físico, hipótese/CID, conduta) até os médicos validarem os campos por especialidade.
- **Critérios de aceite:** registro assinado não pode ser alterado nem pela API nem por SQL direto do usuário da aplicação; retificação mostra original e nova versão; edição concorrente devolve 409 sem perder texto; secretária e administrador não acessam.

## Etapa 7 — Auditoria e telas

- **Entrega:** trilha de auditoria encadeada, painel de auditoria, interface web/PWA das etapas anteriores (Dashboard simples, Pacientes, Agenda, Prontuário, Profissionais, Configurações), testes ponta a ponta com Playwright.
- **Critérios de aceite:** adulteração de um evento de auditoria é detectada pela verificação de cadeia; fluxos ponta a ponta de secretária (cadastrar e agendar) e de médico (atender, registrar, assinar) passam no navegador automatizado; telas e menus mudam conforme o perfil.

## Fora do MVP (próximas fases, na ordem da seção 28)

Documentos médicos e assinatura ICP-Brasil → financeiro → CRM/WhatsApp → integrações → IA nível 1 → IA nível 2 → IA nível 3 (após validações). Também antes de produção: matriz de conformidade, modelagem de ameaças completa, plano de backup testado e resposta a incidentes, escolha e contratação de hospedagem (com sua autorização). Os quatro primeiros foram preparados em 2026-10-31 ([conformidade](../conformidade/matriz-de-conformidade.md), [operação](../operacao/backup-e-restauracao.md)); a hospedagem depende da sua autorização.

## Como as entregas chegam a você

Cada etapa termina com um Pull Request no GitHub contendo: o que mudou em linguagem simples, como testar, e a saída real dos testes do CI. Você revisa e clica em "Merge". Nada vai para produção nesta fase, porque produção ainda não existe.
