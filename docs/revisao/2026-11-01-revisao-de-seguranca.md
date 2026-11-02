# Revisão de segurança (2026-11-01)

Revisão do código como estava depois da IA nível 2 (PR #38), feita por Claude a pedido do
responsável. **Não é teste de invasão nem auditoria independente**: é uma leitura do código com
testes automáticos para cada correção. Antes de produção, continua necessário um teste de
invasão feito por terceiros ([modelagem de ameaças](../conformidade/modelagem-de-ameacas.md),
item 6).

## O que foi olhado

- Todas as 114 rotas da API: login, sessão, CSRF, autorização e escopo por organização.
- Senhas, MFA, bloqueio por tentativas, limite de login por IP, reautenticação.
- Cifragem de CPF e segredos, consultas SQL manuais, validação de entrada.
- Cabeçalhos HTTP, cache, arquivos baixados (PDF e JSON), registros de erro.
- Aplicativo web: onde o HTML é montado, armazenamento no navegador, links externos.
- Dependências (`npm audit`) e segredos no histórico inteiro do Git (gitleaks).

## Achados

| #   | Gravidade    | Achado                                                                                                                                                                                                                                                      | Situação                                                                                                                                                                                                                                          |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Média        | Com `TRUST_PROXY=true` (o que a documentação mandava usar em produção), a API pegava o **primeiro** IP do cabeçalho `X-Forwarded-For`, que o próprio cliente escreve. Trocando esse valor a cada tentativa, um atacante escapava do limite de login por IP. | **Corrigido.** `TRUST_PROXY` passa a ser o número de proxies (`true` vale 1). Teste mostra que trocar o cabeçalho não escapa mais; com o comportamento antigo, o mesmo teste falha.                                                               |
| 2   | Baixa        | As respostas da API (dados de paciente, PDF de documento, cópia do prontuário) não diziam ao navegador e a proxies para **não guardar cópia**.                                                                                                              | **Corrigido.** Toda resposta da API leva `Cache-Control: no-store`. Teste em `health.test.ts`.                                                                                                                                                    |
| 3   | Reforço      | Nada garantia, de forma automática, que uma rota nova passasse pela política de acesso: dependia de quem escreve a rota lembrar.                                                                                                                            | **Corrigido.** Rota com login que termina sem decisão da política vira 403 e o erro vai para o registro. Os testes exercitam as 105 rotas com login; todas passam pela política.                                                                  |
| 4   | Baixa        | O site não tinha política de conteúdo (CSP) nem cabeçalhos de segurança definidos.                                                                                                                                                                          | **Corrigido no projeto.** Política definida em `apps/web/vite.config.ts` e servida no teste ponta a ponta, que reprova qualquer bloqueio. A hospedagem precisa repetir os cabeçalhos.                                                             |
| 5   | Baixa        | Dois dados sensíveis vão no endereço (URL): a busca de paciente por CPF ou telefone (`GET /patients?q=`) e a justificativa para abrir registro sensível (`?justification=`). Endereços costumam ir para registros de proxies.                               | **Corrigido (2026-11-02).** Busca em `POST /patients/search` e justificativa em `POST /records/:id/open`, as duas no corpo ([ADR 0033](../adr/0033-busca-e-justificativa-no-corpo.md)). Proxy sem registro da query string continua como reforço. |
| 6   | Decisão      | O MFA (código de 6 dígitos) é obrigatório para médico e administrador, mas não para a secretária, que vê CPF, telefone e agenda.                                                                                                                            | **Decidido (2026-11-02): exigir.** `MFA_REQUIRED_ROLES` passa a ter `secretary` no padrão.                                                                                                                                                        |
| 7   | Aceito       | O bloqueio da conta depois de 5 senhas erradas pode ser usado por alguém para travar o login de outra pessoa por 15 minutos.                                                                                                                                | Aceito: o bloqueio protege contra adivinhação de senha e é curto; o limite por IP reduz o abuso. O administrador pode redefinir o acesso.                                                                                                         |
| 8   | Documentação | A modelagem de ameaças ainda dizia que o limite de login ficava na memória; desde o PR #33 ele fica no banco.                                                                                                                                               | **Corrigido** na modelagem de ameaças.                                                                                                                                                                                                            |

## O que está certo (conferido no código)

- Senhas com Argon2id; sessão guardada só como resumo SHA-256; cookie `httpOnly`, `SameSite=Strict`
  e `Secure` obrigatório em produção; token CSRF comparado em tempo constante.
- Bloqueio por tentativas vale para login, MFA, troca de senha e reautenticação, e derruba todas as
  sessões da pessoa. Troca de senha e redefinição de acesso também derrubam as outras sessões.
- Perfil e unidades lidos do banco a cada requisição: tirar um acesso vale na hora.
- Em produção, a API recusa as chaves públicas de desenvolvimento e chaves repetidas.
- CPF cifrado; a busca usa um resumo com chave (HMAC), não um resumo simples que daria para
  adivinhar.
- SQL manual só com valores parametrizados; corpo das requisições validado com esquemas estritos
  (campo a mais é recusado).
- Toda busca por identificador filtra pela organização; de outra organização, a resposta é 404.
- Web: nenhum HTML montado a partir de texto; nada de paciente no armazenamento do navegador; link
  externo do PDF com `rel="noreferrer"`.
- `npm audit --omit=dev`: 0 problemas. Só no build: 4 de gravidade baixa (`deepmerge`, sem versão
  corrigida; [ADR 0029](../adr/0029-avisos-do-build-e-registro-de-erros.md)).
- gitleaks no histórico inteiro: nenhum segredo.

## O que esta revisão não cobre

- Teste de invasão com ferramentas e pessoa de fora.
- A hospedagem (ainda não escolhida): HTTPS, HSTS, proxy, registros, cofre de segredos.
- Revisão das bibliotecas de terceiros por dentro.
