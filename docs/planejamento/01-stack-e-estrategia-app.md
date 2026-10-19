# 01 — Stack tecnológica e estratégia web / PWA / aplicativo

Atende às seções 2, 10 e 13 do Prompt Mestre. Status: **proposta, aguardando aprovação**.

## 1. Premissas que guiaram a escolha

- Porte pequeno: até 5 médicos, 1–2 secretárias, 10–30 consultas/dia. Isso significa poucas dezenas de usuários simultâneos no máximo. Qualquer stack moderna aguenta essa carga com folga; o que pesa é **segurança, custo de manutenção e facilidade de transferir para uma equipe humana**.
- O desenvolvimento será feito majoritariamente por um agente de IA, supervisionado por alguém que pode não ser programador. Logo, convém **uma única linguagem** no projeto inteiro, tipagem forte (erros aparecem antes de rodar) e ferramentas muito difundidas no mercado brasileiro.
- Dados clínicos são sensíveis (LGPD, art. 11). A autorização precisa morar **no servidor**, e o mínimo possível de prontuário deve ficar guardado em celulares e navegadores.

## 2. Recomendação (resumo)

| Camada           | Recomendado                                                                                                                                                                             | Alternativa considerada       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Linguagem        | **TypeScript** em todo o projeto                                                                                                                                                        | Python (Django) no backend    |
| Frontend         | **React + Vite** (SPA), TanStack Router/Query, componentes acessíveis (Radix/shadcn-ui)                                                                                                 | Next.js                       |
| Aplicativo       | **PWA** (instalável no celular e no computador); empacotamento com **Capacitor** só se houver necessidade de loja                                                                       | Flutter, nativo               |
| Backend          | **NestJS** (Node.js 22 LTS)                                                                                                                                                             | Django + DRF                  |
| Contratos de API | REST + OpenAPI gerado do código; validação com **Zod** compartilhada entre front e back                                                                                                 | GraphQL                       |
| Banco            | **PostgreSQL 16**                                                                                                                                                                       | MySQL, MongoDB                |
| ORM / migrações  | **Prisma** (migrações versionadas em SQL, com SQL manual para gatilhos de auditoria)                                                                                                    | Drizzle, TypeORM              |
| Autenticação     | Própria no backend: senha com **Argon2id**, sessão em cookie `HttpOnly` no servidor, **MFA TOTP** obrigatório para perfis clínicos e administrativos; WebAuthn (chave de acesso) depois | Keycloak, Auth0/Clerk         |
| Autorização      | Motor de políticas próprio (RBAC + ABAC) em módulo isolado, chamado por todas as rotas, anexos, exportações e IA                                                                        | Casbin, OPA                   |
| Arquivos/anexos  | Armazenamento de objetos compatível com S3, criptografado, acessado só por URL temporária emitida após checar permissão                                                                 | Arquivos no disco do servidor |
| Filas/tarefas    | **pg-boss** (fila dentro do próprio PostgreSQL)                                                                                                                                         | Redis + BullMQ                |
| Testes           | Vitest (unidade), Supertest + banco real (integração), Playwright (ponta a ponta)                                                                                                       | Jest, Cypress                 |
| Qualidade        | ESLint, Prettier, `tsc --strict`, `npm audit`, Dependabot, Gitleaks (segredos), Semgrep                                                                                                 | SonarQube                     |

## 3. Por que essa combinação

**TypeScript de ponta a ponta.** Os mesmos esquemas de validação (por exemplo, "CPF válido", "consulta não pode terminar antes de começar") são escritos uma vez e usados na tela e no servidor. Para um projeto conduzido por agente, isso reduz muito a chance de a tela aceitar algo que o servidor recusa, ou vice-versa. É também a stack com maior oferta de desenvolvedores no Brasil, o que facilita a transferência.

**React + Vite em vez de Next.js.** O sistema é inteiramente autenticado: não há páginas públicas que precisem de SEO nem renderização no servidor. Uma SPA simples com Vite é mais fácil de entender, testar e transformar em PWA. Next.js traz um segundo servidor e regras de cache que aumentam a superfície de erro sem benefício aqui. Revisão possível se surgir um portal público do paciente ou site institucional.

**NestJS em vez de Django.** Django é excelente (autenticação, admin e migrações prontos) e seria a melhor escolha se a equipe fosse Python. Os motivos para NestJS aqui: uma só linguagem com o frontend; módulos com fronteiras explícitas (Pacientes, Agenda, Prontuário, Financeiro…), o que ajuda a manter separação lógica entre dados administrativos, clínicos, financeiros e de IA (seção 7); e "guards" e "interceptors" que tornam natural forçar autorização e auditoria em todas as rotas. O admin automático do Django seria, inclusive, um risco: daria a administradores uma porta para dados clínicos, o que a seção 4 proíbe por padrão.

**PostgreSQL.** Transações confiáveis, restrições de integridade, índices de texto com remoção de acentos (busca de pacientes), JSONB para formulários configuráveis por especialidade, gatilhos para tornar registros assinados e trilhas de auditoria imutáveis, e Row-Level Security disponível como segunda camada no futuro. Oferecido como serviço gerenciado por todos os grandes provedores com região no Brasil.

**Fila no próprio PostgreSQL (pg-boss).** Lembretes de WhatsApp, processamento de anexos e tarefas de IA precisam de fila, mas com 30 consultas/dia não há motivo para manter um Redis separado. Um componente a menos para proteger, pagar e fazer backup.

**Autenticação própria e simples, em vez de serviço externo.** Serviços como Auth0/Clerk guardariam dados de identidade fora do controle da clínica e têm custo por usuário; Keycloak é robusto mas pesado para operar. Com poucos usuários, sessões no servidor (revogáveis na hora) + MFA cobrem o necessário. Revisão se surgir login por gov.br, SSO corporativo ou portal do paciente.

## 4. Estratégia web / PWA / híbrido / nativo

| Opção                 | Prós                                                                                                                           | Contras                                                                                                               | Veredito                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Web responsiva        | Um código só; atualização instantânea; nada instalado                                                                          | Não aparece como "app"; sem notificações em alguns cenários                                                           | Base de tudo                                    |
| **PWA**               | Mesmo código da web; instalável no Android, iOS (16.4+), Windows e macOS; ícone na tela inicial; notificações push; tela cheia | Na App Store/Play Store não aparece sem empacotar; recursos nativos limitados                                         | **Recomendado para começar**                    |
| Híbrido (Capacitor)   | Reaproveita 100% do código da PWA; publica nas lojas; acesso a câmera, biometria, arquivos                                     | Processo de publicação nas lojas, contas de desenvolvedor pagas, revisões da Apple                                    | **Fase posterior**, só se a loja for necessária |
| Flutter               | Ótimo desempenho e visual consistente                                                                                          | Segunda linguagem (Dart) e segundo código para a web; web do Flutter é fraca para formulários longos e acessibilidade | Descartado                                      |
| Nativo (Swift/Kotlin) | Máximo desempenho                                                                                                              | Três códigos para manter; custo incompatível com o porte                                                              | Descartado                                      |

**Recomendação:** começar como **aplicação web responsiva instalável (PWA)**. Ela já funciona "como aplicativo" em celular, tablet e computador. Se mais adiante for importante estar na App Store/Play Store (por exemplo, para biometria nativa ou um app do paciente), o mesmo código é empacotado com Capacitor sem reescrita.

### Offline e contingência (seção 13)

- **Não** manter cópia local do prontuário completo. O app guarda em cache apenas a "casca" (telas, ícones) e, no máximo, a agenda do dia em modo somente leitura.
- Rascunhos de evolução em digitação são salvos no servidor a cada poucos segundos (salvamento automático) e, se a internet cair, ficam temporariamente no dispositivo **criptografados e com prazo curto**, sendo enviados assim que a conexão volta. Nada assinado é criado offline.
- Plano de contingência em papel/impressão para queda prolongada (agenda do dia exportável em PDF pela secretária, com controle de acesso), a detalhar no módulo de operação.

## 5. Hospedagem de produção (decisão futura, não necessária agora)

Para quando chegar a homologação/produção, a direção recomendada é um provedor com **região no Brasil** (São Paulo), com banco PostgreSQL gerenciado (backups automáticos e criptografia em repouso), armazenamento de objetos criptografado e execução em contêiner. Exemplos: AWS (sa-east-1), Azure (Brazil South), Google Cloud (southamerica-east1) ou provedor nacional. Custo, contrato (DPA/LGPD) e região serão comparados em documento próprio antes de qualquer contratação; nada pago será contratado sem sua autorização.

## 6. Riscos e condições de revisão

- **Dependência de bibliotecas de terceiros** → travar versões, Dependabot e auditoria automática no CI.
- **PWA no iOS tem limitações** (armazenamento, notificações) → se secretárias/médicos usarem iPhone intensamente, antecipar o empacotamento com Capacitor.
- **Motor de autorização próprio** é peça crítica → cobertura de testes de autorização obrigatória (seção 22) e revisão por especialista de segurança antes de produção.
- Revisar a stack se: a clínica passar de ~50 usuários simultâneos, surgir portal do paciente, ou vierem organizações juridicamente independentes (multi-tenant real).
