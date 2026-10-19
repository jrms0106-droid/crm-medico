# ADR 0011: Auditoria de toda decisão de acesso, com matriz de papéis declarativa

- **Status:** aceito (2026-10-19, Etapa 2)
- **Decisão:**
  - A matriz papel × recurso × ação fica num catálogo único e declarativo (`packages/policy/src/rules.ts`). As regras de atributo (organização, dado clínico, vínculo assistencial, unidade) são negações explícitas avaliadas antes das concessões.
  - Cada recurso declara a sua classe de dado no catálogo. Quem chama a política informa só o tipo do recurso, para que ninguém consiga rotular um dado clínico como administrativo por engano.
  - Toda chamada a `AuthorizationService.authorize` grava um evento em `audit.events`, permitido ou negado. Identificadores fora do alcance do usuário geram 404 e um evento `not_found`.
  - A tabela de auditoria é somente-acréscimo desde já: um gatilho recusa `UPDATE` e `DELETE`. Uma coluna `seq` crescente prepara o encadeamento por hash da Etapa 7.
  - Se a gravação do evento falhar, a operação falha (fail closed).
- **Motivo:** A especificação exige auditoria de toda decisão desde a Etapa 2 e negação por padrão. Um catálogo único permite um teste de matriz completo, comparado a uma tabela esperada escrita à parte.
- **Alternativas descartadas:**
  - Auditar só as negações: perderia o rastro de quem acessou o quê.
  - Gravar a auditoria de forma assíncrona (fila): mais rápido, mas permite acesso sem registro se a fila falhar.
- **Riscos:**
  - Volume de eventos alto, já que cada leitura vira um evento. Para 5 médicos e 2 secretárias é pequeno. Revisar índices e retenção antes da produção.
  - O gatilho não impede `TRUNCATE` nem um superusuário. O papel de banco da aplicação sem esses privilégios entra na Etapa 7.
- **Revisar quando:** A Etapa 7 introduzir o encadeamento por hash e o painel, ou o volume de eventos afetar o tempo de resposta.
