import { z } from 'zod';

export const RECORD_KINDS = ['consultation', 'evolution', 'addendum'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_STATUSES = [
  'draft',
  'finalized',
  'signed',
  'rectified',
  'archived',
  'discarded',
] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const RECORD_SENSITIVITIES = ['normal', 'elevated', 'restricted'] as const;
export type RecordSensitivity = (typeof RECORD_SENSITIVITIES)[number];

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  draft: 'Rascunho',
  finalized: 'Finalizado, aguardando assinatura',
  signed: 'Assinado',
  rectified: 'Retificado',
  archived: 'Arquivado',
  discarded: 'Descartado',
};

/** Versão do formulário genérico (docs/api/prontuario.md), até a validação por especialidade. */
export const GENERIC_FORM_VERSION = 'generic-v1';

const longText = z.string().max(20_000, 'Máximo de 20.000 caracteres.');
export const ICD10_PATTERN = /^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,2})?$/;

export const recordContentSchema = z.strictObject({
  chiefComplaint: longText.optional(),
  anamnesis: longText.optional(),
  physicalExam: longText.optional(),
  hypotheses: z
    .array(
      z.strictObject({
        description: z.string().trim().min(1, 'Descreva a hipótese.').max(500),
        icd10: z
          .string()
          .trim()
          .toUpperCase()
          .regex(ICD10_PATTERN, 'CID-10 em formato inválido (exemplo: J06.9).')
          .optional(),
      }),
    )
    .max(20, 'No máximo 20 hipóteses.')
    .optional(),
  plan: longText.optional(),
});
export type RecordContent = z.infer<typeof recordContentSchema>;

/** O conteúdo tem algo escrito? Registro vazio não pode ser finalizado. */
export function hasContent(c: RecordContent): boolean {
  const texts = [c.chiefComplaint, c.anamnesis, c.physicalExam, c.plan];
  return texts.some((t) => (t ?? '').trim().length > 0) || (c.hypotheses?.length ?? 0) > 0;
}

const clinicalDate = z.iso.date('Data inválida: use AAAA-MM-DD.');

export const recordCreateSchema = z.strictObject({
  kind: z.enum(['consultation', 'evolution']).default('consultation'),
  clinicalDate: clinicalDate.optional(),
  sensitivity: z.enum(RECORD_SENSITIVITIES).default('normal'),
  content: recordContentSchema.default({}),
});

export const recordUpdateSchema = z.strictObject({
  version: z.number().int().min(1),
  content: recordContentSchema.optional(),
  clinicalDate: clinicalDate.optional(),
  sensitivity: z.enum(RECORD_SENSITIVITIES).optional(),
});

export const recordVersionSchema = z.strictObject({ version: z.number().int().min(1) });

const reasonText = (min: number) =>
  z
    .string()
    .trim()
    .min(min, `Escreva ao menos ${min} caracteres.`)
    .max(1000, 'Máximo de 1.000 caracteres.');

export const recordReopenSchema = z.strictObject({ reason: reasonText(3) });

export const recordCorrectionSchema = z.strictObject({
  justification: reasonText(10),
  content: recordContentSchema.optional(),
});

export const recordViewQuerySchema = z.strictObject({
  justification: reasonText(10).optional(),
});

export const timelineQuerySchema = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export interface RecordDto {
  id: string;
  patientId: string;
  author: { id: string; name: string };
  encounterId: string | null;
  kind: RecordKind;
  clinicalDate: string;
  sensitivity: RecordSensitivity;
  status: RecordStatus;
  version: number;
  formVersion: string;
  content: RecordContent;
  contentHash: string | null;
  signedAt: string | null;
  integrity: 'valid' | 'invalid' | null;
  rectifiesId: string | null;
  rectifiedById: string | null;
  addendumOfId: string | null;
  justification: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordSummaryDto {
  id: string;
  author: { id: string; name: string };
  kind: RecordKind;
  clinicalDate: string;
  sensitivity: RecordSensitivity;
  status: RecordStatus;
  rectifiesId: string | null;
  rectifiedById: string | null;
  addendumOfId: string | null;
  /** Registro sensível de outro autor: o conteúdo só abre com justificativa. */
  contentHidden: boolean;
  content: RecordContent | null;
}

export interface RecordVersionDto {
  version: number;
  savedAt: string;
  savedBy: { id: string; name: string };
  content: RecordContent;
}
