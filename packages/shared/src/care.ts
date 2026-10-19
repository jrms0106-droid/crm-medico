import { z } from 'zod';

/** Estados do vínculo assistencial (docs/api/atendimento-e-vinculo.md). */
export const CARE_STATES = [
  'scheduled',
  'confirmed',
  'started',
  'follow_up',
  'closed',
  'expired',
] as const;
export type CareState = (typeof CARE_STATES)[number];

export const CARE_STATE_LABELS: Record<CareState, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  started: 'Atendimento iniciado',
  follow_up: 'Acompanhamento ativo',
  closed: 'Atendimento encerrado (período de cortesia)',
  expired: 'Vínculo expirado',
};

export const encounterCloseSchema = z.strictObject({
  followUpDays: z
    .number()
    .int()
    .min(1, 'O acompanhamento precisa ter ao menos 1 dia.')
    .max(365, 'O acompanhamento pode ter no máximo 365 dias.')
    .optional(),
});

export const emergencyAccessSchema = z.strictObject({
  justification: z
    .string()
    .trim()
    .min(20, 'Descreva a emergência com ao menos 20 caracteres.')
    .max(1000, 'Máximo de 1.000 caracteres.'),
});

export const emergencyReviewSchema = z.strictObject({
  outcome: z.enum(['appropriate', 'inappropriate']),
  notes: z
    .string()
    .trim()
    .min(3, 'Registre uma observação de ao menos 3 caracteres.')
    .max(1000, 'Máximo de 1.000 caracteres.'),
});

export const emergencyReviewQuerySchema = z.strictObject({
  status: z.enum(['pending', 'reviewed']).default('pending'),
});

export interface EncounterDto {
  id: string;
  appointmentId: string;
  patientId: string;
  doctorUserId: string;
  unitId: string;
  status: 'started' | 'closed';
  startedAt: string;
  closedAt: string | null;
  followUpUntil: string | null;
}

export interface CareAccessDto {
  state: CareState | null;
  emergencyUntil: string | null;
  can: {
    viewSummary: boolean;
    viewHistory: boolean;
    createRecords: boolean;
    viewOwnRecords: boolean;
    viewSensitiveOfOthers: 'allowed' | 'justification_required' | 'denied';
  };
}

export interface EmergencyAccessDto {
  id: string;
  patientId: string;
  requestedBy: { id: string; name: string };
  justification: string;
  startsAt: string;
  expiresAt: string;
  active: boolean;
  review: {
    outcome: 'appropriate' | 'inappropriate';
    notes: string;
    reviewedAt: string;
    reviewedBy: { id: string; name: string };
  } | null;
}
