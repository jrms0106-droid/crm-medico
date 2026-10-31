import { z } from 'zod';

/** CRM e lembretes (docs/api/crm-e-lembretes.md). */
export const MESSAGE_STATUSES = ['queued', 'sent', 'failed', 'cancelled'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  queued: 'Na fila',
  sent: 'Enviado (simulado)',
  failed: 'Falhou',
  cancelled: 'Cancelado',
};

export const MESSAGE_KIND_LABELS: Record<string, string> = {
  appointment_reminder: 'Lembrete de consulta',
};

/** O lembrete sai entre 2 e 24 horas antes da consulta. */
export const REMINDER_MIN_LEAD_HOURS = 2;
export const REMINDER_MAX_LEAD_HOURS = 24;
export const MESSAGE_MAX_ATTEMPTS = 3;

export const messageListQuerySchema = z.strictObject({
  status: z.enum(MESSAGE_STATUSES).optional(),
  patientId: z.uuid('Paciente inválido.').optional(),
});

export const messageCancelSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(3, 'Informe o motivo (ao menos 3 caracteres).')
    .max(200, 'Máximo de 200 caracteres.'),
});

/** Texto do lembrete: só primeiro nome, data, hora e unidade. */
export function reminderText(input: {
  firstName: string;
  date: string;
  time: string;
  unit: string;
}): string {
  const [y, m, d] = input.date.split('-');
  return (
    `Olá, ${input.firstName}. Lembrete: sua consulta é em ${d}/${m}/${y} às ${input.time}, ` +
    `na ${input.unit}. Para remarcar ou cancelar, ligue para a clínica.`
  );
}

export interface MessageDto {
  id: string;
  patient: { id: string; name: string };
  appointment: { id: string; startsAt: string };
  unit: { id: string; name: string };
  kind: string;
  channel: string;
  toNumberMasked: string;
  body: string;
  status: MessageStatus;
  scheduledFor: string;
  attempts: number;
  sentAt: string | null;
  providerRef: string | null;
  lastError: string | null;
  cancelReason: string | null;
  cancelledBy: { id: string; name: string } | null;
  createdAt: string;
}

/** Mostra só os 4 últimos dígitos do telefone. */
export const maskPhone = (digits: string) => `(••) •••••-${digits.slice(-4)}`;
