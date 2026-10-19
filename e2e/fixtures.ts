/** Dados fictícios fixos dos testes ponta a ponta (criados por e2e/seed.ts). */
export const E2E_PASSWORD = 'senha-ficticia-e2e-2026';
/** Segredo TOTP público, só para testes. */
export const E2E_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export const USERS = {
  admin: { email: 'admin@e2e-ficticia.test', name: 'Ana Admin (fictícia)', mfa: true },
  doctor: { email: 'medico@e2e-ficticia.test', name: 'Dr. Bruno Teste (fictício)', mfa: true },
  secretary: { email: 'secretaria@e2e-ficticia.test', name: 'Carla Teste (fictícia)', mfa: false },
} as const;

export type UserKey = keyof typeof USERS;
