import { z } from 'zod';
import { roleSchema } from './auth.js';

/** Siglas das 27 unidades da federação, para CRM/UF. */
export const BRAZIL_STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;
export const brazilStateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(BRAZIL_STATES, 'UF inválida.'));

const name = (max: number) =>
  z
    .string()
    .trim()
    .min(2, 'Informe ao menos 2 caracteres.')
    .max(max, `Máximo de ${max} caracteres.`);
const digits = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,10}$/, `${label} deve ter de 1 a 10 dígitos.`);
const id = z.uuid('Identificador inválido.');

// Unidades
export const unitCreateSchema = z.strictObject({
  name: name(200),
  timezone: z.string().trim().min(1).max(64).optional(),
});
export const unitUpdateSchema = z.strictObject({
  name: name(200).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  active: z.boolean().optional(),
});
export interface UnitDto {
  id: string;
  name: string;
  timezone: string;
  active: boolean;
}

// Especialidades
export const specialtyCreateSchema = z.strictObject({ name: name(120) });
export const specialtyUpdateSchema = z.strictObject({
  name: name(120).optional(),
  active: z.boolean().optional(),
});
export interface SpecialtyDto {
  id: string;
  name: string;
  active: boolean;
}

// Profissionais
const professionalSpecialtiesSchema = z
  .array(z.strictObject({ specialtyId: id, rqe: digits('O RQE').optional() }))
  .max(10)
  .refine(
    (list) => new Set(list.map((s) => s.specialtyId)).size === list.length,
    'Especialidade repetida.',
  );
export const professionalCreateSchema = z.strictObject({
  userId: id,
  crmNumber: digits('O CRM'),
  crmState: brazilStateSchema,
  specialties: professionalSpecialtiesSchema.default([]),
});
export const professionalUpdateSchema = z.strictObject({
  crmNumber: digits('O CRM').optional(),
  crmState: brazilStateSchema.optional(),
  specialties: professionalSpecialtiesSchema.optional(),
  active: z.boolean().optional(),
});
export interface ProfessionalDto {
  id: string;
  userId: string;
  name: string;
  crmNumber: string;
  crmState: string;
  active: boolean;
  specialties: { id: string; name: string; rqe: string | null }[];
}

// Contas de usuário (administração)
const rolesSchema = z
  .array(roleSchema)
  .min(1, 'Escolha ao menos um papel.')
  .transform((roles) => [...new Set(roles)]);
const unitIdsSchema = z
  .array(id)
  .min(1, 'Escolha ao menos uma unidade.')
  .max(50)
  .transform((ids) => [...new Set(ids)]);
export const userCreateSchema = z.strictObject({
  name: name(200),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(254),
  roles: rolesSchema,
  unitIds: unitIdsSchema,
});
export const userUpdateSchema = z.strictObject({
  name: name(200).optional(),
  roles: rolesSchema.optional(),
  unitIds: unitIdsSchema.optional(),
});
export interface UserAccountDto {
  id: string;
  name: string;
  email: string;
  roles: z.infer<typeof roleSchema>[];
  unitIds: string[];
  active: boolean;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  professionalId: string | null;
}

// Auditoria
export const AUDIT_OUTCOMES = ['allowed', 'denied', 'not_found'] as const;
export const auditQuerySchema = z.strictObject({
  outcome: z.enum(AUDIT_OUTCOMES).optional(),
  actorUserId: id.optional(),
  patientId: id.optional(),
  resourceType: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(32).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.iso.datetime().optional(),
  after: z.iso.datetime().optional(),
});
export interface AuditEventDto {
  id: string;
  /** Posição na cadeia de auditoria da organização (docs/api/auditoria.md). */
  chainSeq: number;
  occurredAt: string;
  actorUserId: string | null;
  requestId: string | null;
  ip: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  unitId: string | null;
  patientId: string | null;
  outcome: (typeof AUDIT_OUTCOMES)[number];
  reason: string;
}

export const AUDIT_CHAIN_ISSUES = ['gap', 'link', 'content'] as const;
export interface AuditChainReportDto {
  valid: boolean;
  checked: number;
  headSeq: number | null;
  headHash: string | null;
  problems: { chainSeq: number; eventId: string; issue: (typeof AUDIT_CHAIN_ISSUES)[number] }[];
}
