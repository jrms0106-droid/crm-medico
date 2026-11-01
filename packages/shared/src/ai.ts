import { z } from 'zod';
import type { RecordKind } from './records.js';

/** IA nível 1, administrativa (docs/api/ia-nivel-1.md). */
export const AI_FEATURES = [
  'message_draft',
  'request_triage',
  'schedule_suggestions',
  'admin_report',
  'record_draft',
  'record_summary',
] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  message_draft: 'Rascunho de mensagem ao paciente',
  request_triage: 'Classificação de pedidos dos pacientes',
  schedule_suggestions: 'Organização da agenda',
  admin_report: 'Relatório administrativo assistido',
  record_draft: 'Organizar anotações no registro (médico)',
  record_summary: 'Resumo do prontuário com fontes (médico)',
};

/** Funcionalidades da recepção (`ai_assist`) e do administrador (`ai_report`). */
export const AI_RECEPTION_FEATURES: readonly AiFeature[] = [
  'message_draft',
  'request_triage',
  'schedule_suggestions',
];

/** IA nível 2, documental: só o médico (`ai_clinical`). */
export const AI_CLINICAL_FEATURES: readonly AiFeature[] = ['record_draft', 'record_summary'];

export const AI_SIMULATED_NOTICE =
  'Sugestão do modelo simulado: nenhum serviço de IA está contratado e nenhum dado sai do sistema. ' +
  'Revise antes de usar.';

export const MESSAGE_PURPOSES = ['confirmation', 'reschedule', 'no_show', 'notice'] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];

export const MESSAGE_PURPOSE_LABELS: Record<MessagePurpose, string> = {
  confirmation: 'Confirmar consulta',
  reschedule: 'Pedir para remarcar',
  no_show: 'Falta na consulta',
  notice: 'Aviso administrativo',
};

export const TRIAGE_CATEGORIES = [
  'scheduling',
  'reschedule',
  'cancellation',
  'billing',
  'documents',
  'clinical',
  'other',
] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

export const TRIAGE_CATEGORY_LABELS: Record<TriageCategory, string> = {
  scheduling: 'Marcar consulta',
  reschedule: 'Remarcar',
  cancellation: 'Cancelar',
  billing: 'Pagamento ou recibo',
  documents: 'Documentos',
  clinical: 'Dúvida de saúde (passar ao médico)',
  other: 'Outro assunto',
};

/** Aviso fixo quando o texto fala de sinais de alerta. Não é orientação de saúde da IA. */
export const TRIAGE_URGENT_NOTICE =
  'Atenção: a mensagem fala de um possível sinal de alerta. Oriente o paciente a procurar o ' +
  'pronto-socorro ou ligar 192 (SAMU) e avise o médico agora.';

export const AI_DECISIONS = ['draft', 'accepted', 'discarded'] as const;
export type AiDecision = (typeof AI_DECISIONS)[number];

export const AI_DECISION_LABELS: Record<AiDecision, string> = {
  draft: 'Aguardando revisão',
  accepted: 'Usado',
  discarded: 'Descartado',
};

export const aiFeatureToggleSchema = z.strictObject({ enabled: z.boolean() });

export const messageDraftSchema = z.strictObject({
  purpose: z.enum(MESSAGE_PURPOSES, 'Escolha o motivo da mensagem.'),
  appointmentId: z.uuid('Consulta inválida.').optional(),
  note: z.string().trim().max(300, 'Máximo de 300 caracteres.').optional(),
});

export const requestTriageSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(3, 'Cole a mensagem do paciente.')
    .max(2000, 'Máximo de 2.000 caracteres.'),
});

export const aiDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('accepted'), edited: z.boolean() }),
  z.strictObject({ decision: z.literal('discarded') }),
]);

/** Formato fixo da classificação. Saída do modelo fora dele é descartada. */
export const triageOutputSchema = z.strictObject({
  category: z.enum(TRIAGE_CATEGORIES),
  urgent: z.boolean(),
  suggestedReply: z.string().trim().min(1).max(1000),
});
export type TriageOutput = z.infer<typeof triageOutputSchema>;

// ---- Organização da agenda ----

export const scheduleSuggestionsSchema = z.strictObject({
  scheduleId: z.uuid('Agenda inválida.'),
  date: z.iso.date('Data inválida: use AAAA-MM-DD.'),
});

export const SCHEDULE_SUGGESTIONS_MAX = 10;

/** Formato fixo da saída do modelo: só códigos (`H1`, `E1`, `C1`), nunca nomes. */
export const scheduleSuggestionsOutputSchema = z.strictObject({
  suggestions: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('fill_slot'),
          slot: z.string().regex(/^H\d{1,3}$/),
          waitlist: z.string().regex(/^E\d{1,3}$/),
          reason: z.string().trim().min(1).max(200),
        }),
        z.strictObject({
          kind: z.literal('confirm'),
          appointment: z.string().regex(/^C\d{1,3}$/),
          reason: z.string().trim().min(1).max(200),
        }),
      ]),
    )
    .max(SCHEDULE_SUGGESTIONS_MAX),
});
export type ScheduleSuggestionsOutput = z.infer<typeof scheduleSuggestionsOutputSchema>;

export type ScheduleSuggestionDto =
  | {
      kind: 'fill_slot';
      startsAt: string;
      endsAt: string;
      waitlistEntryId: string;
      patientName: string;
      preference: string | null;
      reason: string;
    }
  | {
      kind: 'confirm';
      appointmentId: string;
      startsAt: string;
      patientName: string;
      reason: string;
    };

export interface ScheduleSuggestionsDto {
  requestId: string;
  scheduleId: string;
  date: string;
  /** Fatos calculados pelo sistema, para conferência. */
  facts: { freeSlots: number; unconfirmed: number; waiting: number };
  suggestions: ScheduleSuggestionDto[];
  model: AiModelInfoDto;
  notice: string;
}

// ---- Relatório assistido ----

export const ADMIN_REPORT_MAX_DAYS = 92;

export const adminReportSchema = z.strictObject({
  from: z.iso.date('Data inválida: use AAAA-MM-DD.'),
  to: z.iso.date('Data inválida: use AAAA-MM-DD.'),
  unitId: z.uuid('Unidade inválida.').optional(),
});

export const adminReportOutputSchema = z.strictObject({
  highlights: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
});

/** Números agregados do período, calculados pelo sistema. Nenhum dado de paciente. */
export interface AdminReportMetrics {
  appointments: {
    total: number;
    scheduled: number;
    confirmed: number;
    arrived: number;
    cancelled: number;
    noShow: number;
    rescheduled: number;
    fitIn: number;
  };
  /** Faltas sobre (comparecimentos + faltas), em %, uma casa decimal; `null` sem base. */
  noShowRate: number | null;
  newPatients: number;
  waiting: number;
  reminders: { sent: number; failed: number };
  billing: { netCents: number; receivedCents: number; openCents: number };
}

export interface AdminReportDto {
  requestId: string;
  from: string;
  to: string;
  unitId: string | null;
  metrics: AdminReportMetrics;
  highlights: string[];
  model: AiModelInfoDto;
  notice: string;
}

/** Número inteiro no padrão brasileiro: 1234 → "1.234". */
export const formatCount = (n: number) => n.toLocaleString('pt-BR');

/** Percentual com uma casa: 12.5 → "12,5". */
export const formatPercent = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/** Números escritos num texto ("1.234,56", "12,5", "30"). */
export const numbersIn = (text: string): string[] => text.match(/\d(?:[\d.,]*\d)?/g) ?? [];

export interface AiFeatureDto {
  feature: AiFeature;
  label: string;
  enabled: boolean;
  updatedAt: string | null;
}

export interface AiModelInfoDto {
  provider: string;
  model: string;
  version: string;
}

export interface MessageDraftDto {
  requestId: string;
  text: string;
  model: AiModelInfoDto;
  notice: string;
}

export interface RequestTriageDto {
  requestId: string;
  category: TriageCategory;
  urgent: boolean;
  suggestedReply: string;
  model: AiModelInfoDto;
  notice: string;
}

export interface AiRequestDto {
  id: string;
  feature: AiFeature;
  purpose: string;
  user: { id: string; name: string };
  model: AiModelInfoDto;
  inputChars: number;
  /** Só para quem pediu; o administrador vê o uso sem o texto. */
  output: string | null;
  decision: AiDecision;
  edited: boolean | null;
  decidedAt: string | null;
  createdAt: string;
}

// ---- IA nível 2, documental (docs/api/ia-nivel-2.md) ----

export const AI_CLINICAL_NOTICE =
  'Rascunho do modelo simulado: o assistente só reorganiza frases que já existem, sem mudar uma ' +
  'letra, e não preenche hipóteses nem CID. Revise; nada entra no prontuário sem você salvar e ' +
  'assinar.';

export const RECORD_NOTES_MAX_CHARS = 8000;
export const RECORD_NOTES_MAX_SENTENCES = 60;
export const RECORD_SUMMARY_MAX_RECORDS = 10;
export const RECORD_SUMMARY_MAX_ITEMS = 12;

/** Campos de texto do registro que a IA pode organizar. Hipóteses e CID nunca. */
export const AI_RECORD_FIELDS = ['chiefComplaint', 'anamnesis', 'physicalExam', 'plan'] as const;
export type AiRecordField = (typeof AI_RECORD_FIELDS)[number];

export const AI_RECORD_FIELD_LABELS: Record<AiRecordField, string> = {
  chiefComplaint: 'Motivo da consulta',
  anamnesis: 'Anamnese',
  physicalExam: 'Exame físico',
  plan: 'Conduta',
};

/**
 * Divide um texto em frases: ponto final, interrogação, exclamação e ponto e vírgula seguidos de
 * espaço, e quebras de linha. Pontos dentro de números ("37.8", "1.000") não cortam.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/\r?\n+|(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export const recordDraftSuggestionSchema = z.strictObject({
  patientId: z.uuid('Paciente inválido.'),
  notes: z
    .string()
    .trim()
    .min(3, 'Escreva as anotações da consulta.')
    .max(RECORD_NOTES_MAX_CHARS, 'Máximo de 8.000 caracteres.'),
});

export const recordSummarySuggestionSchema = z.strictObject({
  patientId: z.uuid('Paciente inválido.'),
});

const sentenceCode = z.string().regex(/^S\d{1,2}$/);

/** Saída do modelo: só códigos de frase por campo. */
export const recordDraftOutputSchema = z.strictObject({
  fields: z.strictObject({
    chiefComplaint: z.array(sentenceCode).max(RECORD_NOTES_MAX_SENTENCES),
    anamnesis: z.array(sentenceCode).max(RECORD_NOTES_MAX_SENTENCES),
    physicalExam: z.array(sentenceCode).max(RECORD_NOTES_MAX_SENTENCES),
    plan: z.array(sentenceCode).max(RECORD_NOTES_MAX_SENTENCES),
  }),
});
export type RecordDraftOutput = z.infer<typeof recordDraftOutputSchema>;

/** Saída do modelo: itens com o campo e os códigos `R<n>.S<m>` das frases. */
export const recordSummaryOutputSchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        field: z.enum(AI_RECORD_FIELDS),
        refs: z
          .array(z.string().regex(/^R\d{1,2}\.S\d{1,3}$/))
          .min(1)
          .max(5),
      }),
    )
    .max(RECORD_SUMMARY_MAX_ITEMS),
});
export type RecordSummaryOutput = z.infer<typeof recordSummaryOutputSchema>;

export interface RecordDraftSuggestionDto {
  requestId: string;
  /** Texto de cada campo, montado com as frases originais, e os números das frases usadas. */
  fields: { field: AiRecordField; label: string; text: string; sentences: number[] }[];
  /** Frases que o modelo não colocou em nenhum campo, para nada se perder. */
  unassigned: { number: number; text: string }[];
  model: AiModelInfoDto;
  notice: string;
}

export interface RecordSummaryItemDto {
  field: AiRecordField;
  label: string;
  /** Frases originais, sem alteração. */
  text: string;
  source: {
    recordId: string;
    clinicalDate: string;
    kind: RecordKind;
    authorName: string;
  };
}

export interface RecordSummarySuggestionDto {
  requestId: string;
  items: RecordSummaryItemDto[];
  /** Registros assinados usados como fonte. */
  recordsUsed: number;
  /** Registros sensíveis de outro médico que ficaram de fora (abrir exige justificativa). */
  sensitiveHidden: number;
  model: AiModelInfoDto;
  notice: string;
}
