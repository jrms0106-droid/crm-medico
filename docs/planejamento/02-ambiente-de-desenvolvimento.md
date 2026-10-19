# 02 — Ambiente de desenvolvimento recomendado

Atende às seções 11, 15 e 18 do Prompt Mestre. Status: **proposta, aguardando aprovação**.

## 1. O que foi verificado no ambiente atual

Verificado nesta sessão (não presumido):

- Esta conversa roda em um **contêiner na nuvem, isolado e temporário**: Node.js 22, PostgreSQL 16 e Git instalados; Docker instalado mas sem serviço ativo. O contêiner é descartado após inatividade, então todo trabalho precisa ir para um repositório Git.
- Há uma pasta compartilhada do projeto (`/mnt/project-files/`) onde estão estes documentos.
- Sua conta GitHub tem 4 repositórios. Um deles, **prontuOS**, é um prontuário instalável (Electron) que grava os dados em arquivo no próprio computador, para um único usuário. Ele é **público** e a arquitetura é incompatível com o que este projeto pede (vários usuários, servidor central, permissões por vínculo, auditoria, agenda compartilhada). Pode servir de referência de telas, mas não de base de código.
- Nenhum repositório está ligado a este projeto ainda.

## 2. Opções comparadas

| Critério                         | A. Agente na nuvem (Claude Code) + GitHub privado                                              | B. Máquina local + Docker + Claude Code CLI                          | C. GitHub Codespaces    |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------- |
| Isolamento                       | Alto: cada sessão é um contêiner descartável, sem acesso à sua máquina                         | Médio: o agente roda no seu computador, com acesso aos seus arquivos | Alto                    |
| Controle de versão               | Todo trabalho vira commit e Pull Request revisável                                             | Igual, depende de disciplina local                                   | Igual                   |
| Execução de testes               | Sim (Node, PostgreSQL disponíveis; CI no GitHub Actions)                                       | Sim, inclusive Docker                                                | Sim                     |
| Segredos                         | Nenhum segredo de produção existe no ambiente; segredos de CI no GitHub Secrets                | Risco de `.env` com chaves reais esquecido na máquina                | GitHub Secrets          |
| Custo                            | Incluído no seu plano Claude; GitHub Actions gratuito em volume baixo para repositório privado | Gratuito, mas exige máquina preparada                                | Pago após cota gratuita |
| Manutenção para você             | Nenhuma instalação                                                                             | Instalar Node, Docker, Git, configurar                               | Baixa                   |
| Transferência para equipe humana | Simples: o repositório GitHub é o projeto inteiro                                              | Simples, se tudo estiver no repositório                              | Simples                 |
| Adequado para dados reais?       | **Não**                                                                                        | **Não**                                                              | **Não**                 |

## 3. Recomendação

**Principal: opção A.** Desenvolvimento pelo agente na nuvem, em um **repositório GitHub privado novo** (sugestão de nome: `crm-medico`), com:

- Branch `main` protegida: mudanças só entram por Pull Request com CI verde e sua aprovação (você clica "Merge"; o agente nunca aprova a si mesmo).
- GitHub Actions rodando a cada PR: tipos, lint, formatação, testes unitários, testes de integração com PostgreSQL real, testes de autorização, auditoria de dependências e varredura de segredos.
- Dependabot e varredura de segredos ativados.
- Somente **dados fictícios** gerados por script (`npm run seed`), com CPFs válidos porém inventados.

**Alternativa: opção B**, para quando uma equipe humana assumir ou se você quiser rodar o sistema no seu computador. O repositório já virá com `docker-compose.yml` (PostgreSQL + armazenamento de arquivos local) e instruções passo a passo, então a migração é direta.

## 4. Separação de ambientes (seção 18)

| Ambiente                | Onde                                                | Dados                                   | Quem acessa                 |
| ----------------------- | --------------------------------------------------- | --------------------------------------- | --------------------------- |
| Desenvolvimento         | Contêiner do agente / máquina local                 | Fictícios, recriados a qualquer momento | Agente, desenvolvedores     |
| Testes automáticos (CI) | GitHub Actions                                      | Fictícios, descartados a cada execução  | Automático                  |
| Homologação             | Nuvem, conta separada (a contratar com autorização) | Fictícios                               | Equipe e usuários-piloto    |
| Produção                | Nuvem no Brasil, conta e credenciais separadas      | **Reais**                               | Somente usuários da clínica |

Nenhum dado real de paciente entra em desenvolvimento, CI ou homologação. Cópias de produção para teste são proibidas; se um dia forem necessárias, só anonimizadas e com aprovação formal.

## 5. Estrutura proposta do repositório (seção 15)

```
crm-medico/
├── apps/
│   ├── api/            # backend NestJS (um módulo por domínio)
│   └── web/            # frontend React + Vite (PWA)
├── packages/
│   ├── shared/         # esquemas Zod, tipos, códigos de erro compartilhados
│   └── policy/         # motor de autorização RBAC+ABAC (puro, 100% testado)
├── prisma/             # esquema e migrações versionadas do banco
├── docs/
│   ├── adr/            # registros de decisões arquiteturais
│   ├── api/            # contratos OpenAPI e regras de negócio por módulo
│   ├── conformidade/   # matriz de conformidade, ameaças, retenção
│   └── operacao/       # instalação, backup, incidentes
├── scripts/            # seed de dados fictícios, utilitários
├── .github/workflows/  # CI
├── docker-compose.yml
└── .env.example        # só nomes de variáveis, nunca valores reais
```

Convenções: código e identificadores em inglês (padrão do mercado, facilita contratar), textos da interface e documentação em português; commits pequenos e descritivos; cada módulo só acessa o banco das suas próprias tabelas e conversa com outros módulos por serviços explícitos.

## 6. O que preciso de você para começar

Como regra de segurança desta sessão, o agente não cria repositórios na sua conta. O passo é seu e leva um minuto:

1. Em github.com, clique em **New repository**, nome `crm-medico`, marque **Private**, sem README.
2. Me avise aqui. Eu ligo o repositório ao projeto e envio o primeiro Pull Request.

Até lá, a implementação avança localmente nesta sessão e é publicada assim que o repositório existir.
