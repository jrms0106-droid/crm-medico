import { z } from 'zod';
import type { ChargeDto } from './billing.js';
import type { PatientDto } from './patients.js';

/** Direitos do titular dos dados (docs/api/direitos-do-titular.md). */
export const SUBJECT_REQUEST_KINDS = [
  'access',
  'access_report',
  'correction',
  'portability',
  'deletion',
  'sharing_info',
  'other',
] as const;
export type SubjectRequestKind = (typeof SUBJECT_REQUEST_KINDS)[number];

export const SUBJECT_REQUEST_KIND_LABELS: Record<SubjectRequestKind, string> = {
  access: 'Acesso aos dados',
  access_report: 'Relatório de quem acessou',
  correction: 'Correção',
  portability: 'Cópia em formato aberto (portabilidade)',
  deletion: 'Eliminação ou anonimização',
  sharing_info: 'Com quem os dados foram compartilhados',
  other: 'Outro',
};

export const SUBJECT_REQUEST_STATUSES = ['open', 'completed', 'denied'] as const;
export type SubjectRequestStatus = (typeof SUBJECT_REQUEST_STATUSES)[number];

export const SUBJECT_REQUEST_STATUS_LABELS: Record<SubjectRequestStatus, string> = {
  open: 'Aberto',
  completed: 'Atendido',
  denied: 'Negado',
};

/** Prazo da declaração completa (LGPD art. 19, II), em dias corridos. A validar. */
export const SUBJECT_REQUEST_DEADLINE_DAYS = 15;

export const subjectRequestCreateSchema = z.strictObject({
  patientId: z.uuid('Paciente inválido.'),
  kind: z.enum(SUBJECT_REQUEST_KINDS, 'Tipo de pedido inválido.'),
  details: z
    .string()
    .trim()
    .max(1000, 'Máximo de 1000 caracteres.')
    .transform((v) => (v === '' ? undefined : v))
    .optional(),
});

export const subjectRequestResolveSchema = z.strictObject({
  status: z.enum(['completed', 'denied'], 'Informe se o pedido foi atendido ou negado.'),
  resolution: z
    .string()
    .trim()
    .min(3, 'Escreva a resposta dada ao paciente (ao menos 3 caracteres).')
    .max(1000, 'Máximo de 1000 caracteres.'),
});

export const subjectRequestListQuerySchema = z.strictObject({
  status: z.enum(SUBJECT_REQUEST_STATUSES).optional(),
  patientId: z.uuid('Paciente inválido.').optional(),
});

export const accessReportQuerySchema = z
  .strictObject({
    from: z.iso.date('Data inválida: use AAAA-MM-DD.').optional(),
    to: z.iso.date('Data inválida: use AAAA-MM-DD.').optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, 'A data inicial é depois da final.');

export interface SubjectRequestDto {
  id: string;
  patient: { id: string; name: string };
  kind: SubjectRequestKind;
  details: string | null;
  status: SubjectRequestStatus;
  dueOn: string;
  overdue: boolean;
  createdBy: { id: string; name: string };
  createdAt: string;
  resolvedBy: { id: string; name: string } | null;
  resolvedAt: string | null;
  resolution: string | null;
}

/** Rótulos do que foi acessado, por tipo de recurso da auditoria. */
export const ACCESS_REPORT_RESOURCE_LABELS: Record<string, string> = {
  patient_registration: 'Cadastro',
  appointment: 'Consulta da agenda',
  encounter: 'Atendimento',
  clinical_summary: 'Resumo clínico',
  clinical_record: 'Registro do prontuário',
  medical_document: 'Documento médico',
  emergency_access: 'Acesso emergencial',
  charge: 'Cobrança',
  patient_rights: 'Direitos do titular',
};

export const ACCESS_REPORT_ACTION_LABELS: Record<string, string> = {
  view: 'Visualizou',
  create: 'Criou',
  edit: 'Editou',
  correct: 'Corrigiu',
  sign: 'Assinou',
  export: 'Exportou',
  share: 'Compartilhou',
};

export interface AccessReportEntryDto {
  at: string;
  who: { id: string; name: string; roles: string[] } | null;
  resourceType: string;
  action: string;
  outcome: 'allowed' | 'denied' | 'not_found';
  emergency: boolean;
}

export interface AccessReportDto {
  patient: { id: string; name: string };
  from: string | null;
  to: string | null;
  generatedAt: string;
  truncated: boolean;
  entries: AccessReportEntryDto[];
}

export interface PatientExportDto {
  format: 'crm-medico/exportacao-do-titular';
  version: 1;
  generatedAt: string;
  generatedBy: { id: string; name: string };
  organization: { name: string };
  notice: string;
  patient: PatientDto;
  appointments: {
    id: string;
    startsAt: string;
    endsAt: string;
    status: string;
    kind: string;
    unit: string;
    professional: string;
  }[];
  charges: ChargeDto[];
  subjectRequests: SubjectRequestDto[];
  clinical: { included: false; reason: string };
}
