import { z } from 'zod';

/** Documentos emitidos fora do CRM, na plataforma do CFM (docs/api/documentos-externos.md). */
export const EXTERNAL_DOCUMENT_KINDS = [
  'prescription',
  'controlled_prescription',
  'antimicrobial_prescription',
  'certificate',
  'exam_request',
  'other',
] as const;
export type ExternalDocumentKind = (typeof EXTERNAL_DOCUMENT_KINDS)[number];

export const EXTERNAL_DOCUMENT_KIND_LABELS: Record<ExternalDocumentKind, string> = {
  prescription: 'Receita simples',
  controlled_prescription: 'Receita de controle especial',
  antimicrobial_prescription: 'Receita de antimicrobiano',
  certificate: 'Atestado',
  exam_request: 'Pedido de exames',
  other: 'Outro documento',
};

/** Onde o documento foi emitido. A Memed hoje é só simulada (ADR 0045). */
export const EXTERNAL_PLATFORMS = ['cfm', 'memed'] as const;
export type ExternalPlatform = (typeof EXTERNAL_PLATFORMS)[number];

export const EXTERNAL_PLATFORM_LABELS: Record<ExternalPlatform, string> = {
  cfm: 'CFM',
  memed: 'Memed (simulada)',
};

/** Aviso que acompanha toda receita simulada, também gravado no resumo. */
export const SIMULATED_PRESCRIPTION_NOTICE =
  'Receita simulada, sem validade legal: nenhuma plataforma foi contratada.';

export const EXTERNAL_DOCUMENT_STATUSES = ['registered', 'cancelled'] as const;
export type ExternalDocumentStatus = (typeof EXTERNAL_DOCUMENT_STATUSES)[number];

export const EXTERNAL_DOCUMENT_STATUS_LABELS: Record<ExternalDocumentStatus, string> = {
  registered: 'Registrado',
  cancelled: 'Registro cancelado',
};

/** Data mais antiga aceita para a emissão. */
export const EXTERNAL_DOCUMENT_MIN_DATE = '2020-01-01';

export const externalDocumentCreateSchema = z.strictObject({
  kind: z.enum(EXTERNAL_DOCUMENT_KINDS, 'Escolha o tipo de documento.'),
  issuedOn: z.iso
    .date('Data inválida: use AAAA-MM-DD.')
    .refine(
      (d) => d >= EXTERNAL_DOCUMENT_MIN_DATE,
      'A data de emissão não pode ser antes de 2020.',
    ),
  summary: z
    .string()
    .trim()
    .min(3, 'Descreva o que foi emitido (ao menos 3 caracteres).')
    .max(2000, 'Máximo de 2.000 caracteres.'),
  validationCode: z
    .string()
    .trim()
    .max(100, 'Máximo de 100 caracteres.')
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type ExternalDocumentCreateInput = z.infer<typeof externalDocumentCreateSchema>;

const prescriptionItem = z.strictObject({
  medication: z
    .string()
    .trim()
    .min(3, 'Informe o medicamento (ao menos 3 caracteres).')
    .max(200, 'Máximo de 200 caracteres.'),
  instructions: z
    .string()
    .trim()
    .min(3, 'Informe a posologia (ao menos 3 caracteres).')
    .max(300, 'Máximo de 300 caracteres.'),
});

/** Receita simples feita pelo adaptador de prescrição (hoje só o simulado). */
export const memedPrescriptionSchema = z.strictObject({
  items: z
    .array(prescriptionItem)
    .min(1, 'Informe ao menos um medicamento.')
    .max(10, 'No máximo 10 medicamentos.'),
});
export type MemedPrescriptionInput = z.infer<typeof memedPrescriptionSchema>;

export const externalDocumentCancelSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(10, 'Escreva o motivo (ao menos 10 caracteres).')
    .max(1000, 'Máximo de 1.000 caracteres.'),
});

export interface ExternalDocumentDto {
  id: string;
  patientId: string;
  author: { id: string; name: string };
  encounterId: string | null;
  platform: ExternalPlatform;
  kind: ExternalDocumentKind;
  status: ExternalDocumentStatus;
  issuedOn: string;
  summary: string;
  validationCode: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
}
