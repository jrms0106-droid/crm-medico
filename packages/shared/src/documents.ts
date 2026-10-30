import { z } from 'zod';
import { ICD10_PATTERN } from './records.js';

/** Documentos médicos (docs/api/documentos.md). Campos são proposta técnica a validar. */
export const DOCUMENT_KINDS = [
  'prescription',
  'certificate',
  'exam_request',
  'referral',
  'report',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  prescription: 'Receita simples',
  certificate: 'Atestado',
  exam_request: 'Pedido de exames',
  referral: 'Encaminhamento',
  report: 'Relatório médico',
};

export const DOCUMENT_STATUSES = ['draft', 'signed', 'cancelled', 'discarded'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Rascunho',
  signed: 'Assinado',
  cancelled: 'Cancelado',
  discarded: 'Descartado',
};

const required = (max: number, message: string) =>
  z
    .string()
    .trim()
    .min(1, message)
    .max(max, `Máximo de ${max.toLocaleString('pt-BR')} caracteres.`);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max.toLocaleString('pt-BR')} caracteres.`)
    .optional();
const icd10 = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ICD10_PATTERN, 'CID-10 em formato inválido (exemplo: J06.9).');

export const prescriptionContentSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        medication: required(300, 'Informe o medicamento.'),
        instructions: required(1000, 'Informe a posologia.'),
        quantity: optional(100),
      }),
    )
    .min(1, 'Inclua ao menos um medicamento.')
    .max(20, 'No máximo 20 medicamentos.'),
  notes: optional(4000),
});

export const certificateContentSchema = z
  .strictObject({
    purpose: z.enum(['absence', 'attendance']),
    days: z
      .number()
      .int()
      .min(1, 'O afastamento precisa ter ao menos 1 dia.')
      .max(365, 'O afastamento pode ter no máximo 365 dias.')
      .optional(),
    startDate: z.iso.date('Data inválida: use AAAA-MM-DD.').optional(),
    icd10: icd10.optional(),
    icd10Authorized: z.boolean().default(false),
    text: optional(4000),
  })
  .superRefine((c, ctx) => {
    if (c.purpose === 'absence' && c.days === undefined) {
      ctx.addIssue({ code: 'custom', path: ['days'], message: 'Informe os dias de afastamento.' });
    }
    if (c.purpose === 'attendance' && c.days !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['days'],
        message: 'Atestado de comparecimento não tem dias de afastamento.',
      });
    }
    if (c.icd10 && !c.icd10Authorized) {
      ctx.addIssue({
        code: 'custom',
        path: ['icd10Authorized'],
        message: 'O CID só entra no atestado com a autorização do paciente.',
      });
    }
  });

export const examRequestContentSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        exam: required(300, 'Informe o exame.'),
        notes: optional(500),
      }),
    )
    .min(1, 'Inclua ao menos um exame.')
    .max(30, 'No máximo 30 exames.'),
  clinicalIndication: optional(4000),
  icd10: icd10.optional(),
});

export const referralContentSchema = z.strictObject({
  toSpecialty: required(120, 'Informe a especialidade de destino.'),
  reason: required(4000, 'Informe o motivo do encaminhamento.'),
  clinicalSummary: optional(4000),
});

export const reportContentSchema = z.strictObject({
  title: required(200, 'Informe o título do relatório.'),
  body: required(20_000, 'Escreva o relatório.'),
});

export const DOCUMENT_CONTENT_SCHEMAS = {
  prescription: prescriptionContentSchema,
  certificate: certificateContentSchema,
  exam_request: examRequestContentSchema,
  referral: referralContentSchema,
  report: reportContentSchema,
} as const;

export type PrescriptionContent = z.infer<typeof prescriptionContentSchema>;
export type CertificateContent = z.infer<typeof certificateContentSchema>;
export type ExamRequestContent = z.infer<typeof examRequestContentSchema>;
export type ReferralContent = z.infer<typeof referralContentSchema>;
export type ReportContent = z.infer<typeof reportContentSchema>;

export type DocumentContent =
  PrescriptionContent | CertificateContent | ExamRequestContent | ReferralContent | ReportContent;

export const documentCreateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('prescription'), content: prescriptionContentSchema }),
  z.strictObject({ kind: z.literal('certificate'), content: certificateContentSchema }),
  z.strictObject({ kind: z.literal('exam_request'), content: examRequestContentSchema }),
  z.strictObject({ kind: z.literal('referral'), content: referralContentSchema }),
  z.strictObject({ kind: z.literal('report'), content: reportContentSchema }),
]);

/** O conteúdo é conferido depois, com o esquema do tipo do documento gravado. */
export const documentUpdateSchema = z.strictObject({
  version: z.number().int().min(1),
  content: z.unknown(),
});

export const documentVersionSchema = z.strictObject({ version: z.number().int().min(1) });

export const documentCancelSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(10, 'Escreva ao menos 10 caracteres.')
    .max(1000, 'Máximo de 1.000 caracteres.'),
});

/** Retrato de quem e de onde, congelado na assinatura. */
export interface DocumentSnapshot {
  issuer: {
    name: string;
    crm: string;
    specialties: { name: string; rqe: string | null }[];
  };
  patient: { fullName: string; socialName: string | null; birthDate: string };
  place: { organization: string; unit: string | null };
}

export interface DocumentDto {
  id: string;
  patientId: string;
  author: { id: string; name: string };
  encounterId: string | null;
  kind: DocumentKind;
  status: DocumentStatus;
  version: number;
  content: DocumentContent;
  snapshot: DocumentSnapshot | null;
  issuedOn: string | null;
  contentHash: string | null;
  signedAt: string | null;
  integrity: 'valid' | 'invalid' | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummaryDto {
  id: string;
  author: { id: string; name: string };
  kind: DocumentKind;
  status: DocumentStatus;
  issuedOn: string | null;
  createdAt: string;
}

export interface DocumentEventDto {
  type: string;
  at: string;
  by: { id: string; name: string };
  details: unknown;
}
