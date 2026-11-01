# Revisão geral (2026-11-01)

Revisão do que existe até a IA nível 1 (PR #31), feita com o código, os testes e ferramentas
rodadas no contêiner de desenvolvimento, só com dados fictícios. **Não é auditoria independente,
teste de invasão nem certificação.** O MVP continua não apto a uso clínico real.

## O que foi verificado e como

| Área                        | Como                                                                                                                                   | Resultado                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permissão em todas as rotas | script que lista cada rota dos controllers e procura a chamada à política (`authorize`, `notFound` ou carregador que chama a política) | todas as rotas fora do login passam pela política; as de login/MFA são as únicas sem ela, por desenho                                                                                       |
| Sessão e cookies            | leitura de `identity/`                                                                                                                 | cookie `httpOnly`, `sameSite=strict`, `secure` por configuração, caminho `/api`; CSRF por cabeçalho; bloqueio por tentativas e revogação das sessões ao bloquear; TOTP sem reutilizar passo |
| Cabeçalhos e erros          | leitura de `app.ts` e do filtro de erros                                                                                               | `helmet` ligado, CORS só para a origem do app; erro inesperado nunca mostra detalhe ao usuário                                                                                              |
| Dependências                | `npm audit`                                                                                                                            | **0** vulnerabilidades no que vai para produção (`--omit=dev`); avisos moderados só em ferramentas de build do PWA (ver pendências)                                                         |
| Segredos                    | gitleaks no histórico do PR                                                                                                            | nenhum vazamento                                                                                                                                                                            |
| Acessibilidade automática   | **axe-core** (WCAG 2.1 A e AA) em 19 telas: login e todas as telas do menu de secretária, médico e administrador                       | **0** violações                                                                                                                                                                             |
| Listas sem limite           | script que procura consultas sem `take`                                                                                                | quase todas já são limitadas pelo próprio filtro (um paciente, um dia, até 31 dias de agenda); uma pendência abaixo                                                                         |

O axe encontra só parte dos problemas de acessibilidade. Ele não substitui teste com leitor de
tela e com pessoas que usam tecnologia assistiva.

## Corrigido neste PR

- **Atalho "Pular para o conteúdo"**: primeiro item do teclado em todas as telas, para não passar
  pelo menu inteiro a cada página.
- **Foco ao trocar de tela**: o foco vai para o conteúdo, e o leitor de tela anuncia a tela nova.
- **Título da aba** de acordo com a tela ("Agenda · CRM Médico"), útil para leitor de tela e para
  quem usa várias abas.
- **Teste de acessibilidade automático** no e2e: qualquer violação WCAG 2.1 A/AA que o axe
  encontrar nas telas de cada perfil reprova o CI (ADR 0027).

## Pendências para decidir (não corrigidas aqui)

1. ~~**Limite de tentativas do login fica na memória do servidor.**~~ Resolvido em 2026-11-01:
   a contagem foi para o banco e vale entre instâncias (ADR 0028).
2. ~~**Relatório financeiro soma as cobranças em aberto desde sempre.**~~ Resolvido em
   2026-11-01: o saldo em aberto é somado no próprio banco, sem carregar as cobranças.
3. ~~**Avisos do `npm audit` nas ferramentas de build do PWA.**~~ Resolvido em 2026-11-01:
   `overrides` sobem `glob`, `minimatch` e o plugin que puxava `ejs` 3. Sobrou só `deepmerge`
   (gravidade baixa, sem versão corrigida, só no build), registrado no ADR 0029.
4. ~~**Registro de erro inesperado guarda a pilha do erro.**~~ Resolvido em 2026-11-01: o
   registro guarda só tipo, código e linhas da pilha, sem a mensagem (ADR 0029). Em produção,
   os registros ainda precisam de acesso restrito e prazo de guarda.
5. **Testes que só pessoas fazem:** leitor de tela (NVDA, VoiceOver), uso só pelo teclado nas
   telas longas (prontuário, financeiro) e contraste com as cores reais da clínica.
6. **Validação independente** antes de uso real: teste de invasão, avaliação jurídica (LGPD,
   CFM) e revisão das regras clínicas por médicos. Já registrado na
   [matriz de conformidade](../conformidade/matriz-de-conformidade.md).
