import { z } from 'zod';

export const ROLES = ['doctor', 'secretary', 'admin'] as const;
export const roleSchema = z.enum(ROLES);
export type RoleName = z.infer<typeof roleSchema>;

export const ROLE_LABELS: Record<RoleName, string> = {
  doctor: 'Médico(a)',
  secretary: 'Secretária(o)',
  admin: 'Administrador(a)',
};

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Regras de senha compartilhadas pela tela e pelo servidor. Devolve o problema ou `null`. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  }
  if (/^(.)\1+$/.test(password)) return 'A senha não pode ser um único caractere repetido.';
  const localPart = email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    return 'A senha não pode conter o seu e-mail.';
  }
  return null;
}

export const loginRequestSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const mfaCodeRequestSchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos.'),
});

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().max(PASSWORD_MAX_LENGTH),
});

export const reauthRequestSchema = z.strictObject({
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const SESSION_STATES = ['pending_mfa', 'password_change_required', 'active'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const sessionInfoSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    roles: z.array(roleSchema),
  }),
  state: z.enum(SESSION_STATES),
  mfaEnabled: z.boolean(),
  csrfToken: z.string(),
  expiresAt: z.string(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const mfaSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string(),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

export const resetAccessResponseSchema = z.object({
  temporaryPassword: z.string(),
});
