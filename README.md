# CRM Médico

Sistema de gestão de clínica multiespecialidades com prontuário eletrônico, agenda, CRM, financeiro e IA assistiva.

> **Em desenvolvimento. Não apto a uso clínico real.** Use somente dados fictícios. O sistema só poderá atender pacientes após as validações técnicas, clínicas, jurídicas e regulatórias descritas em [docs/planejamento](docs/planejamento).

## O que existe hoje

- Monorepo TypeScript com API (NestJS), aplicativo web instalável (React + Vite, PWA) e pacotes compartilhados.
- Banco PostgreSQL com migrações versionadas (Prisma) e dados fictícios de exemplo.
- Formato único de erros da API, cabeçalhos de segurança e identificador por requisição.
- Motor de autorização com negação por padrão e matriz de permissões por perfil (médico, secretária, administrador), com auditoria de toda decisão de acesso ([regras](docs/api/organizacao-e-permissoes.md)).
- Cadastro de unidades, especialidades, fichas profissionais (CRM/UF e RQE) e contas de usuário pelo administrador.
- Login com senha (Argon2id), sessão no servidor, bloqueio por tentativas, verificação em duas etapas (TOTP) obrigatória para médicos e administradores, troca de senha e recuperação de acesso pelo administrador ([regras](docs/api/identidade.md)).
- Cadastro de pacientes com nome social, CPF validado e criptografado, responsáveis, contatos de emergência e preferências de comunicação; busca sem acento por nome, CPF ou telefone; alerta de duplicidade; histórico de versões ([regras](docs/api/pacientes.md)).
- Agenda por profissional e unidade: horários de atendimento, bloqueios, disponibilidade, encaixe, retorno, confirmação, presença, falta, cancelamento com motivo, reagendamento com histórico e lista de espera. O banco impede duas consultas no mesmo horário, mesmo com pedidos simultâneos ([regras](docs/api/agenda.md)).
- Atendimento e vínculo assistencial: o que o médico vê do paciente depende do estado do vínculo (agendado, confirmado, atendimento iniciado, acompanhamento ativo, encerrado, expirado), com acesso emergencial temporário, justificado e revisado pelo administrador ([regras](docs/api/atendimento-e-vinculo.md)). A tabela de estados é uma proposta que precisa de validação médica.
- Prontuário básico (formulário genérico): rascunho com salvamento por versões e aviso de conflito de edição, finalização, assinatura eletrônica interna com reautenticação e resumo SHA-256, registro assinado congelado pelo próprio banco, retificação e adendo com justificativa, sensibilidade com justificativa de acesso e linha do tempo ([regras](docs/api/prontuario.md)). A assinatura não é ICP-Brasil e o nível exigido depende de validação jurídica.
- Trilha de auditoria encadeada por hash, calculada pelo próprio banco, com verificação que aponta evento alterado, apagado ou fora de ordem ([regras](docs/api/auditoria.md)).
- Documentos médicos: receita simples, atestado, pedido de exames, encaminhamento e relatório, com rascunho, assinatura interna com reautenticação, cancelamento com motivo e PDF ([regras](docs/api/documentos.md)). Sem ICP-Brasil e sem receita de controle especial; os campos dependem de validação médica e jurídica.
- Financeiro particular: tabela de preços, cobranças com desconto, pagamentos em dinheiro, Pix ou cartão (registrados na recepção, sem integração), proteção contra pagamento em dobro, estorno pelo administrador e relatório por período ([regras](docs/api/financeiro.md)). Sem convênios e sem nota fiscal.
- Telas por perfil no aplicativo web: pacientes, agenda, prontuário com assinatura, documentos, financeiro, profissionais, auditoria e configurações (usuários, unidades, especialidades, fichas profissionais, agendas e tabela de preços), com testes ponta a ponta no navegador ([telas](docs/telas.md)).
- Direitos do paciente (LGPD): registro dos pedidos com prazo, relatório de quem acessou os dados (tirado da auditoria, sem conteúdo clínico) e exportação dos dados em JSON com reautenticação ([regras](docs/api/direitos-do-titular.md)). A cópia do prontuário é gerada pelo médico com vínculo, em arquivo separado.
- Preparação para produção (sem nada contratado): papel de banco da aplicação sem poderes de dono, backup cifrado com ensaio de restauração que confere o conteúdo, matriz de conformidade, modelagem de ameaças, plano de resposta a incidentes e requisitos de hospedagem ([conformidade](docs/conformidade/matriz-de-conformidade.md), [operação](docs/operacao/backup-e-restauracao.md)). A matriz não é declaração de conformidade.
- Verificações automáticas a cada alteração: tipos, lint, formatação, testes, vulnerabilidades e segredos.

O plano completo está em [docs/planejamento/04-plano-do-mvp.md](docs/planejamento/04-plano-do-mvp.md).

## Estrutura

```
apps/api           backend NestJS (um módulo por domínio)
apps/web           frontend React + Vite (PWA)
packages/shared    esquemas de validação, tipos e códigos de erro usados por API e web
packages/policy    motor de autorização RBAC + ABAC (sem banco, 100% testável)
prisma/            esquema e migrações do banco
scripts/           dados fictícios e utilitários
docs/adr/          decisões arquiteturais
docs/conformidade/ matriz de conformidade e modelagem de ameaças
docs/operacao/     papéis do banco, backup, incidentes e hospedagem
docs/planejamento/ stack, ambiente, arquitetura e plano do MVP
```

## Como rodar no seu computador

Pré-requisitos: Node.js 22 e Docker (ou um PostgreSQL 16 próprio).

```bash
cp .env.example .env          # configurações locais (nunca coloque credenciais reais)
docker compose up -d          # sobe o PostgreSQL de desenvolvimento e o de testes
npm install                   # instala dependências e gera o cliente do banco
npm run db:migrate            # cria as tabelas
npm run db:seed               # cria a clínica fictícia de exemplo
npm run build                 # compila os pacotes
npm run dev                   # API em http://localhost:3000 e app em http://localhost:5173
```

Usuários fictícios criados pelo seed (senha `senha-de-desenvolvimento`, só para desenvolvimento):
`admin@clinica-ficticia.test`, `medico@clinica-ficticia.test` e `secretaria@clinica-ficticia.test`.
No primeiro login, médico e administrador cadastram a verificação em duas etapas num aplicativo autenticador.
O seed também cria a "Unidade Centro", quatro especialidades, a ficha profissional do médico (CRM 000001/SP, fictício) três pacientes fictícios e a agenda do médico (segunda a sexta, 08:00–12:00 e 14:00–18:00).

## Verificações

```bash
npm run check    # formatação + lint + tipos + todos os testes
npm run e2e      # testes no navegador (depois de npm run build; ver docs/telas.md)
```

Os testes de integração usam um banco real separado (`DATABASE_URL_TEST`, nome terminado em `_test`), que é apagado e recriado a cada execução.

## Regras do projeto

- Nenhum dado real de paciente fora de produção.
- Credenciais nunca entram no repositório (`.env` é ignorado; o CI procura segredos).
- Toda mudança entra por Pull Request com CI verde e aprovação humana.
- Regras de acesso e de negócio são aplicadas no servidor, nunca só na tela.
