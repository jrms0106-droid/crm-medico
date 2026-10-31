# ADR 0020: Papel de banco da aplicação sem poderes de dono e backup lógico cifrado com age

- **Status:** aceito (2026-10-30, preparação para produção)
- **Decisão:**
  - Em produção, a API conecta com o papel `crm_app`, que só lê e grava dados e, na trilha de auditoria, só lê e acrescenta. As migrações e o backup usam o papel dono (`crm`), fora da API. As permissões vêm de um script idempotente (`scripts/db/papel-aplicacao.sql`), rodado depois de cada migração, e são conferidas por `scripts/db/verificar-papel.sql`.
  - O CI aplica o papel, roda a conferência e roda os testes ponta a ponta com a API em `crm_app`.
  - Backup lógico com `pg_dump` (formato custom), cifrado na hora com age por chave pública; a chave privada fica fora do servidor. Um ensaio automático restaura num banco vazio e compara conteúdo, gatilhos e a cadeia de auditoria; roda no CI.
- **Motivo:** Os gatilhos que congelam o prontuário assinado e a auditoria não protegem contra o dono das tabelas, que pode desligá-los. Separar o papel tira esse poder de quem explorar a API. Cifrar com chave pública permite que o servidor faça backup sem conseguir lê-lo. Um ensaio que compara conteúdo prova que a cópia serve, e não só que o arquivo existe.
- **Alternativas descartadas:**
  - Só o backup automático do banco gerenciado: fica no mesmo provedor e não é testado por nós; continua desejável, mas como camada extra.
  - GPG em vez de age: funciona, mas é mais fácil errar a configuração; age tem um só modo seguro e chaves curtas.
  - Segurança por linha (RLS) no PostgreSQL: a regra de acesso já está no `@crm/policy`; duplicá-la no banco agora traria divergência. Reavaliar se houver acesso ao banco fora da API.
- **Consequências:** Esquecer de rodar o script depois de uma migração deixa a API sem permissão na tabela nova (falha fechada). O ensaio usa tempo de CI (alguns segundos). Perder a chave privada do age torna os backups ilegíveis: ela precisa de duas cópias seguras.
- **Revisar quando:** A hospedagem for escolhida (pode oferecer recuperação para um ponto no tempo e cofre de chaves), ou o banco crescer a ponto de o dump lógico ficar lento.
