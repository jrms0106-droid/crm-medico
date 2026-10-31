import { z } from 'zod';

/**
 * Códigos de erro estáveis da API. A tela usa o código para decidir o que mostrar;
 * a mensagem é apenas um texto padrão em português.
 * Ver docs/planejamento/03-arquitetura.md, seção 3.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // Identidade e sessão (docs/api/identidade.md)
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_SETUP_REQUIRED: 'MFA_SETUP_REQUIRED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  INVALID_MFA_CODE: 'INVALID_MFA_CODE',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  CSRF_FAILED: 'CSRF_FAILED',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  // Pacientes (docs/api/pacientes.md)
  CPF_ALREADY_REGISTERED: 'CPF_ALREADY_REGISTERED',
  POSSIBLE_DUPLICATE: 'POSSIBLE_DUPLICATE',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  // Agenda (docs/api/agenda.md)
  OUTSIDE_WORKING_HOURS: 'OUTSIDE_WORKING_HOURS',
  SLOT_BLOCKED: 'SLOT_BLOCKED',
  SLOT_TAKEN: 'SLOT_TAKEN',
  PATIENT_DOUBLE_BOOKED: 'PATIENT_DOUBLE_BOOKED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  BLOCK_HAS_APPOINTMENTS: 'BLOCK_HAS_APPOINTMENTS',
  // Financeiro (docs/api/financeiro.md)
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  AMOUNT_EXCEEDS_BALANCE: 'AMOUNT_EXCEEDS_BALANCE',
  // IA (docs/api/ia-nivel-1.md)
  AI_FEATURE_DISABLED: 'AI_FEATURE_DISABLED',
  AI_INVALID_OUTPUT: 'AI_INVALID_OUTPUT',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const errorDetailSchema = z.object({
  field: z.string().optional(),
  issue: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.array(errorDetailSchema),
  }),
});

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
