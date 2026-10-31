# Modelagem de ameaças

Método STRIDE sobre a arquitetura atual ([03-arquitetura.md](../planejamento/03-arquitetura.md)):
navegador (PWA) → proxy HTTPS da hospedagem → API NestJS → PostgreSQL. Cada ameaça traz a
proteção que **já existe e é testada**, e o risco que **ainda sobra** para tratar antes da produção.

## Ativos e atores

- **Ativos:** prontuário e documentos (dado sensível), cadastro e CPF, financeiro, trilha de
  auditoria, credenciais e segredos de MFA, chaves de criptografia, backups.
- **Atores de risco:** pessoa de fora pela internet; usuário legítimo além do seu papel
  (curiosidade, ex-funcionário); quem obtém uma cópia do banco ou do backup; quem tem acesso
  ao servidor ou ao provedor; dependência de software comprometida.

## Ameaças, proteções e riscos que sobram

| #   | Ameaça (STRIDE)                                             | Proteção existente                                                                                                                     | Risco que sobra e ação                                                                                                                                                              |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **S** Roubo ou adivinhação de senha                         | Argon2id, bloqueio após tentativas, limite por IP, MFA obrigatório para médico e administrador                                         | Limite por IP fica na memória (um servidor só). Com mais de um, mover para o banco. Avaliar MFA obrigatório para secretária.                                                        |
| 2   | **S** Sequestro de sessão                                   | Sessão no servidor, cookie `httpOnly`, `SameSite=Strict`, `Secure` obrigatório em produção, expiração por inatividade e absoluta, CSRF | Depende de HTTPS correto na hospedagem (HSTS no proxy).                                                                                                                             |
| 3   | **T** Alterar prontuário assinado                           | Gatilho no banco congela o assinado; resumo SHA-256; retificação e adendo com histórico                                                | Quem é **dono** do banco pode desligar gatilhos. Mitigado com o papel `crm_app` ([banco-e-papeis.md](../operacao/banco-e-papeis.md)); a senha do dono fica fora do servidor da API. |
| 4   | **T** Apagar ou editar a trilha de auditoria                | Tabela só de acréscimo, encadeada por hash; verificação na tela do administrador; `crm_app` só lê e insere                             | Quem controla o servidor do banco pode reescrever a cadeia inteira. Ação: guardar periodicamente o último resumo (cabeça da cadeia) fora do banco.                                  |
| 5   | **T** Pagamento em dobro ou alteração de valores            | Idempotency-Key, trava da cobrança, gatilhos que impedem apagar e mudar valores, estorno só do administrador com reautenticação        | —                                                                                                                                                                                   |
| 6   | **R** Usuário nega ter acessado ou assinado                 | Auditoria de toda decisão com sessão, IP e request id; assinatura com reautenticação                                                   | Assinatura interna não tem a força jurídica do ICP-Brasil ([matriz](matriz-de-conformidade.md)).                                                                                    |
| 7   | **I** Acesso a prontuário sem vínculo                       | Política no backend, negação por padrão, vínculo calculado, teste permitido e negado em toda rota                                      | Acesso emergencial existe por desenho: depende da revisão humana da fila.                                                                                                           |
| 8   | **I** Vazamento por cópia do banco ou do backup             | CPF e segredos de MFA cifrados na aplicação; backup cifrado com chave pública (age)                                                    | Texto clínico não é cifrado na aplicação: exigir disco e banco cifrados na hospedagem. Chave privada do backup guardada offline.                                                    |
| 9   | **I** Dados no aparelho                                     | Nada de paciente no armazenamento do navegador; o PWA guarda só a "casca"                                                              | Tela aberta em computador compartilhado: expiração por inatividade (30 min). Orientar a equipe.                                                                                     |
| 10  | **I** Mensagens de erro e registros (logs) com dado pessoal | Erros com código estável e mensagem genérica; a API só registra erros inesperados (request id e pilha), sem corpo de requisição        | A mensagem de um erro do banco pode trazer valores. Ação: revisar esses registros e a retenção de logs na hospedagem, sem guardar corpos nem cookies.                               |
| 11  | **D** Excesso de requisições                                | Limite no login                                                                                                                        | Sem limite geral por usuário. Ação: limite no proxy da hospedagem.                                                                                                                  |
| 12  | **D** Perda do servidor ou do banco                         | Backup cifrado e ensaio de restauração automático                                                                                      | Falta agenda diária, cópia fora do provedor e meta de recuperação acordada.                                                                                                         |
| 13  | **E** Usuário ganhar papel que não tem                      | Mudanças de acesso só pelo administrador, com reautenticação; papel lido do servidor a cada requisição                                 | Conta de administrador é crítica: exigir MFA (já obrigatório) e revisar contas ativas mensalmente.                                                                                  |
| 14  | **E** Injeção de SQL                                        | Prisma com parâmetros; SQL manual só com valores parametrizados                                                                        | —                                                                                                                                                                                   |
| 15  | **E** Dependência comprometida                              | Versões travadas no lockfile, `npm audit` (alta/crítica) e Gitleaks no CI, Dependabot                                                  | Ação: revisar as atualizações antes do merge, como já é feito.                                                                                                                      |
| 16  | **I/T** Credenciais no código                               | `.env` fora do Git, Gitleaks no CI, chaves públicas de desenvolvimento recusadas em produção                                           | Em produção, guardar segredos no cofre da hospedagem.                                                                                                                               |

## Itens para fechar antes da produção

1. Hospedagem com HTTPS e HSTS, disco e banco cifrados, região no Brasil
   ([requisitos-de-hospedagem.md](../operacao/requisitos-de-hospedagem.md)).
2. API ligada só com `crm_app`; a senha do papel dono fora do servidor da API.
3. Backup diário agendado com cópia fora do provedor; ensaio de restauração mensal.
4. Cópia periódica da cabeça da cadeia de auditoria fora do banco.
5. Limite de requisições no proxy; logs sem dado pessoal.
6. Teste de invasão independente.
