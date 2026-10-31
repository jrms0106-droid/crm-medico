import { z } from 'zod';

/** IA nível 1, administrativa (docs/api/ia-nivel-1.md). */
export const AI_FEATURES = ['message_draft', 'request_triage'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  message_draft: 'Rascunho de mensagem ao paciente',
  request_triage: 'Classificação de pedidos dos pacientes',
};

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
