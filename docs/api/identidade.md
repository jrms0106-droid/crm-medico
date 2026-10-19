# Módulo de identidade: login, sessão e MFA

Regras definidas antes da implementação (seção 30 do Prompt Mestre). Etapa 1 do plano.

## Entidades

- **Usuário** (`identity.users`): organização, nome, e-mail (único, minúsculo), hash Argon2id da senha, papéis (`doctor`, `secretary`, `admin`), ativo/inativo, `must_change_password`, segredo TOTP **criptografado** (AES-256-GCM), MFA ativo, contador de falhas, bloqueado até, último passo TOTP usado (impede reutilizar o mesmo código).
- **Sessão** (`identity.sessions`): usuário, **hash SHA-256** do token (o token em si só existe no cookie do navegador), token CSRF, MFA verificado, criada em, último uso, expira em (absoluto), revogada em, data da última reautenticação, IP e navegador (para auditoria).

## Estados de uma sessão

| Estado                                               | Pode acessar                                    |
| ---------------------------------------------------- | ----------------------------------------------- |
| `pending_mfa` (senha correta, falta o segundo fator) | Só `/auth/mfa/*`, `/auth/logout`, `/auth/me`    |
| `password_change_required` (senha temporária)        | Só `/auth/password`, `/auth/logout`, `/auth/me` |
| `active`                                             | Rotas protegidas, conforme a política de acesso |
| expirada / revogada                                  | Nada (401)                                      |

MFA é obrigatório para os papéis configurados em `MFA_REQUIRED_ROLES` (padrão: `doctor,admin`). Para os demais, é opcional e, se ativado, passa a ser exigido.

## Regras

- Senha: 12 a 128 caracteres, não pode conter o próprio e-mail. Verificação contra bases de senhas vazadas fica para antes da produção (exige serviço externo).
- Login com e-mail inexistente e com senha errada dão **a mesma resposta** (401 `INVALID_CREDENTIALS`) e levam tempo semelhante.
- 5 falhas seguidas bloqueiam a conta por 15 minutos (423 `ACCOUNT_LOCKED`). Bloqueio também por IP: 20 tentativas de login por minuto (429).
- Sessão expira após 30 min sem uso (`SESSION_IDLE_MINUTES`) e após 12 h no total (`SESSION_ABSOLUTE_HOURS`).
- Desativar um usuário ou redefinir o acesso dele revoga **na hora** todas as sessões.
- Toda requisição que altera dados (POST, PUT, PATCH, DELETE) com sessão exige o cabeçalho `x-csrf-token` igual ao da sessão (403 `CSRF_FAILED`). Cookie `SameSite=Strict` e `HttpOnly`.
- Código TOTP de 6 dígitos, janela de 30 s, tolerância de ±1 janela, e cada código só vale uma vez.
- Reautenticação (senha + código TOTP se o usuário tem MFA) vale 5 minutos e será exigida por ações críticas (assinar, exportar, acesso emergencial, alterar permissões).
- Recuperação de acesso: um administrador gera uma **senha temporária** (mostrada uma única vez), que obriga a troca no próximo login, e apaga o MFA para novo cadastro. Recuperação por e-mail fica para quando houver serviço de e-mail contratado.

## Endpoints (`/api/v1`)

| Método e rota                        | Sessão exigida                                | Corpo                              | Resposta                                  |
| ------------------------------------ | --------------------------------------------- | ---------------------------------- | ----------------------------------------- |
| `POST /auth/login`                   | nenhuma                                       | `{ email, password }`              | 200 `SessionInfo` + cookie; 401, 423, 429 |
| `POST /auth/logout`                  | qualquer                                      | —                                  | 204                                       |
| `GET /auth/me`                       | qualquer                                      | —                                  | 200 `SessionInfo`                         |
| `POST /auth/mfa/setup`               | `pending_mfa` sem MFA cadastrado, ou `active` | —                                  | 200 `{ secret, otpauthUri }`              |
| `POST /auth/mfa/activate`            | idem                                          | `{ code }`                         | 200 `SessionInfo`; 400 `INVALID_MFA_CODE` |
| `POST /auth/mfa/verify`              | `pending_mfa` com MFA cadastrado              | `{ code }`                         | 200 `SessionInfo`; 400                    |
| `POST /auth/password`                | `password_change_required` ou `active`        | `{ currentPassword, newPassword }` | 200 `SessionInfo`                         |
| `POST /auth/reauth`                  | `active`                                      | `{ password, code? }`              | 204                                       |
| `POST /admin/users/:id/reset-access` | `active`, papel admin                         | —                                  | 200 `{ temporaryPassword }`               |

`SessionInfo` = `{ user: { id, name, email, roles }, state, mfaEnabled, csrfToken, expiresAt }`.

## Erros específicos

`INVALID_CREDENTIALS` (401), `ACCOUNT_LOCKED` (423), `MFA_REQUIRED` (403), `MFA_SETUP_REQUIRED` (403), `PASSWORD_CHANGE_REQUIRED` (403), `INVALID_MFA_CODE` (400), `WEAK_PASSWORD` (400), `CSRF_FAILED` (403), `REAUTH_REQUIRED` (403), `SESSION_EXPIRED` (401).
