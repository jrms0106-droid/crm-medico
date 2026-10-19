# ADR 0006: Autenticação própria com MFA

- **Status:** aceito (2026-10-19, aprovado pelo responsável do projeto)
- **Decisão:** Senha com Argon2id, sessão no servidor em cookie HttpOnly, MFA TOTP obrigatório para médicos e administradores; WebAuthn depois.
- **Motivo:** Poucos usuários; dados de identidade ficam sob controle da clínica; sessões revogáveis na hora.
- **Alternativas descartadas:** Auth0/Clerk (dados fora, custo por usuário), Keycloak (pesado de operar).
- **Riscos:** Código de segurança próprio. Mitigação: bibliotecas consagradas, testes obrigatórios e revisão especializada antes de produção.
- **Revisar quando:** Login gov.br, SSO corporativo ou portal do paciente.
