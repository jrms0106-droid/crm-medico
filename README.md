# CRM Médico

Sistema de gestão de clínica multiespecialidades com prontuário eletrônico, agenda, CRM, financeiro e IA assistiva.

> **Em desenvolvimento. Não apto a uso clínico real.** Use somente dados fictícios. O sistema só poderá atender pacientes após as validações técnicas, clínicas, jurídicas e regulatórias descritas em [docs/planejamento](docs/planejamento).

## O que existe hoje

- Monorepo TypeScript com API (NestJS), aplicativo web instalável (React + Vite, PWA) e pacotes compartilhados.
- Banco PostgreSQL com migrações versionadas (Prisma) e dados fictícios de exemplo.
- Formato único de erros da API, cabeçalhos de segurança e identificador por requisição.
- Motor de autorização com negação por padrão e matriz de permissões por perfil (médico, secretária, administrador), com auditoria de toda decisão de acesso ([regras](docs/api/organizacao-e-permissoes.md)).
- Cadastro de unidades, especialidades, fichas profissionais (CRM/UF e RQE) e contas de usuário pelo administrador (por enquanto só pela API; as telas chegam na Etapa 7).
- Login com senha (Argon2id), sessão no servidor, bloqueio por tentativas, verificação em duas etapas (TOTP) obrigatória para médicos e administradores, troca de senha e recuperação de acesso pelo administrador ([regras](docs/api/identidade.md)).
- Cadastro de pacientes com nome social, CPF validado e criptografado, responsáveis, contatos de emergência e preferências de comunicação; busca sem acento por nome, CPF ou telefone; alerta de duplicidade; histórico de versões ([regras](docs/api/pacientes.md)).
- Agenda por profissional e unidade: horários de atendimento, bloqueios, disponibilidade, encaixe, retorno, confirmação, presença, falta, cancelamento com motivo, reagendamento com histórico e lista de espera. O banco impede duas consultas no mesmo horário, mesmo com pedidos simultâneos ([regras](docs/api/agenda.md)).
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
```

Os testes de integração usam um banco real separado (`DATABASE_URL_TEST`, nome terminado em `_test`), que é apagado e recriado a cada execução.

## Regras do projeto

- Nenhum dado real de paciente fora de produção.
- Credenciais nunca entram no repositório (`.env` é ignorado; o CI procura segredos).
- Toda mudança entra por Pull Request com CI verde e aprovação humana.
- Regras de acesso e de negócio são aplicadas no servidor, nunca só na tela.
