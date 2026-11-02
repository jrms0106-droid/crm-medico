import { z } from 'zod';
import { isValidCpf, normalizeCpf } from './cpf.js';
import { brazilStateSchema } from './org.js';
import { onlyDigits } from './text.js';

/** DDD (dois dígitos sem zero) + fixo de 8 dígitos (2 a 8) ou celular de 9 dígitos começando com 9. */
export const BR_PHONE = /^[1-9]{2}(9\d{8}|[2-8]\d{7})$/;

export const isMobilePhone = (digits: string) => digits.length === 11;

export const COMM_CHANNELS = ['whatsapp', 'sms', 'email', 'phone'] as const;
export type CommChannel = (typeof COMM_CHANNELS)[number];

export const COMM_CHANNEL_LABELS: Record<CommChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'E-mail',
  phone: 'Ligação',
};

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `Informe ao menos ${min} caracteres.`)
    .max(max, `Máximo de ${max} caracteres.`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres.`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const phoneNumber = z
  .string()
  .transform(onlyDigits)
  .refine((v) => BR_PHONE.test(v), 'Telefone inválido: use DDD + número.');

const email = z.string().trim().toLowerCase().email('E-mail inválido.').max(254);

export const cpfSchema = z.string().transform(normalizeCpf).refine(isValidCpf, 'CPF inválido.');

export const birthDateSchema = z.iso
  .date('Data inválida: use AAAA-MM-DD.')
  .refine((v) => v >= '1900-01-01', 'Data de nascimento anterior a 1900.');

const phoneSchema = z.strictObject({
  number: phoneNumber,
  whatsapp: z.boolean().default(false),
});

const addressSchema = z.strictObject({
  zip: z
    .string()
    .transform(onlyDigits)
    .refine((v) => /^\d{8}$/.test(v), 'CEP deve ter 8 dígitos.'),
  street: text(2, 200),
  number: text(1, 20),
  complement: optionalText(100),
  district: text(2, 100),
  city: text(2, 100),
  state: brazilStateSchema,
});

const guardianSchema = z.strictObject({
  name: text(3, 200),
  relationship: text(2, 60),
  phone: phoneNumber.nullable().optional(),
  email: email.nullable().optional(),
});

const emergencyContactSchema = z.strictObject({
  name: text(3, 200),
  relationship: text(2, 60),
  phone: phoneNumber,
});

const communicationSchema = z.strictObject({
  channels: z
    .array(z.enum(COMM_CHANNELS))
    .max(COMM_CHANNELS.length)
    .transform((list) => [...new Set(list)]),
  appointmentReminders: z.boolean(),
  marketing: z.boolean(),
});

const NO_COMMUNICATION = { channels: [], appointmentReminders: false, marketing: false };

const patientFields = {
  fullName: text(3, 200),
  socialName: optionalText(200),
  cpf: cpfSchema.nullable().optional(),
  birthDate: birthDateSchema,
  email: email.nullable().optional(),
  phones: z.array(phoneSchema).min(1, 'Informe ao menos um telefone.').max(5),
  address: addressSchema.nullable().optional(),
  guardians: z.array(guardianSchema).max(3),
  emergencyContacts: z.array(emergencyContactSchema).max(3),
  communication: communicationSchema,
};

interface ChannelCheck {
  email?: string | null | undefined;
  phones?: { number: string; whatsapp: boolean }[] | undefined;
  communication?: { channels: CommChannel[] } | undefined;
}

/** Só se autoriza canal para o qual o cadastro tem o contato correspondente. */
export function channelProblems(data: ChannelCheck): { field: string; issue: string }[] {
  const channels = data.communication?.channels ?? [];
  const phones = data.phones ?? [];
  const problems: { field: string; issue: string }[] = [];
  if (channels.includes('email') && !data.email) {
    problems.push({
      field: 'communication.channels',
      issue: 'E-mail autorizado sem e-mail no cadastro.',
    });
  }
  if (channels.includes('whatsapp') && !phones.some((p) => p.whatsapp)) {
    problems.push({
      field: 'communication.channels',
      issue: 'WhatsApp autorizado sem telefone com WhatsApp.',
    });
  }
  if (channels.includes('sms') && !phones.some((p) => isMobilePhone(p.number))) {
    problems.push({
      field: 'communication.channels',
      issue: 'SMS autorizado sem celular no cadastro.',
    });
  }
  return problems;
}

export const patientCreateSchema = z
  .strictObject({
    ...patientFields,
    guardians: patientFields.guardians.default([]),
    emergencyContacts: patientFields.emergencyContacts.default([]),
    communication: communicationSchema.default(NO_COMMUNICATION),
    allowPossibleDuplicate: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    for (const p of channelProblems(data))
      ctx.addIssue({ code: 'custom', path: p.field.split('.'), message: p.issue });
  });
export type PatientCreateInput = z.infer<typeof patientCreateSchema>;

/** Edição parcial. As listas, quando enviadas, substituem as anteriores. */
export const patientUpdateSchema = z.strictObject({
  version: z.number().int().min(1),
  fullName: patientFields.fullName.optional(),
  socialName: patientFields.socialName,
  cpf: patientFields.cpf,
  birthDate: birthDateSchema.optional(),
  email: patientFields.email,
  phones: patientFields.phones.optional(),
  address: patientFields.address,
  guardians: patientFields.guardians.optional(),
  emergencyContacts: patientFields.emergencyContacts.optional(),
  communication: communicationSchema.optional(),
  active: z.boolean().optional(),
});
export type PatientUpdateInput = z.infer<typeof patientUpdateSchema>;

export const duplicateCheckSchema = z.strictObject({
  fullName: text(3, 200),
  birthDate: birthDateSchema,
  cpf: cpfSchema.nullable().optional(),
  phones: z.array(phoneNumber).max(5).default([]),
});

export const patientSearchSchema = z.strictObject({
  q: z.string().trim().min(2, 'Digite ao menos 2 caracteres.').max(100),
  includeInactive: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(20),
});

export interface PatientPhoneDto {
  number: string;
  whatsapp: boolean;
}

export interface PatientAddressDto {
  zip: string;
  street: string;
  number: string;
  complement: string | null;
  district: string;
  city: string;
  state: string;
}

export interface PatientDto {
  id: string;
  displayName: string;
  fullName: string;
  socialName: string | null;
  cpf: string | null;
  birthDate: string;
  email: string | null;
  phones: PatientPhoneDto[];
  address: PatientAddressDto | null;
  guardians: { name: string; relationship: string; phone: string | null; email: string | null }[];
  emergencyContacts: { name: string; relationship: string; phone: string }[];
  communication: { channels: CommChannel[]; appointmentReminders: boolean; marketing: boolean };
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PatientSummaryDto {
  id: string;
  displayName: string;
  fullName: string;
  socialName: string | null;
  birthDate: string;
  cpfMasked: string | null;
  primaryPhone: string | null;
  active: boolean;
}

export interface PatientVersionDto {
  version: number;
  changedAt: string;
  changedBy: { id: string; name: string };
  changedFields: string[];
  snapshot: Omit<PatientDto, 'cpf' | 'version' | 'createdAt' | 'updatedAt' | 'id'> & {
    hasCpf: boolean;
  };
}

/** "***.456.789-**": mostra só os dígitos do meio. */
export function maskCpf(cpf: string): string {
  const d = normalizeCpf(cpf);
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

/** Nome exibido: o nome social, quando existe, substitui o civil. */
export function displayName(p: { fullName: string; socialName?: string | null }): string {
  return p.socialName || p.fullName;
}

/** Idade completa em anos numa data de referência (AAAA-MM-DD). */
export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

const NAME_STOPWORDS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

/**
 * Nomes parecidos para alerta de duplicidade: metade ou mais das palavras coincidem
 * (sem acentos e sem "da/de/do..."), ou um nome contém o outro. Recebe nomes já normalizados.
 */
export function similarNames(a: string, b: string): boolean {
  const padded = (s: string) => ` ${s} `;
  if (padded(a).includes(padded(b)) || padded(b).includes(padded(a))) return true;
  const words = (s: string) => new Set(s.split(' ').filter((w) => w && !NAME_STOPWORDS.has(w)));
  const wa = words(a);
  const wb = words(b);
  const common = [...wa].filter((w) => wb.has(w)).length;
  return common > 0 && common * 2 >= Math.min(wa.size, wb.size);
}
