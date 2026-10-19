import { z } from 'zod';

export const APPOINTMENT_KINDS = ['regular', 'return', 'fit_in'] as const;
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'arrived',
  'cancelled',
  'no_show',
  'rescheduled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Estados que ocupam o horário na agenda. */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'confirmed', 'arrived'];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  arrived: 'Paciente chegou',
  cancelled: 'Cancelada',
  no_show: 'Falta',
  rescheduled: 'Reagendada',
};

export const WEEKDAY_LABELS = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
];

const id = z.uuid('Identificador inválido.');
const instant = z.iso.datetime({
  offset: true,
  message: 'Data e hora inválidas: use ISO 8601 com fuso.',
});
const duration = z
  .number()
  .int()
  .min(5, 'Duração mínima de 5 minutos.')
  .max(240, 'Duração máxima de 240 minutos.')
  .refine((v) => v % 5 === 0, 'A duração precisa ser múltipla de 5 minutos.');
const shortText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `Informe ao menos ${min} caracteres.`)
    .max(max, `Máximo de ${max} caracteres.`);

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;
export const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
export const fromMinutes = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export const scheduleCreateSchema = z.strictObject({
  professionalId: id,
  slotMinutes: duration.default(30),
});

export const scheduleUpdateSchema = z.strictObject({
  slotMinutes: duration.optional(),
  active: z.boolean().optional(),
});

const ruleSchema = z
  .strictObject({
    weekday: z.number().int().min(0).max(6),
    start: z.string().regex(HHMM, 'Horário inválido: use HH:MM.'),
    end: z.string().regex(HHMM, 'Horário inválido: use HH:MM.'),
  })
  .refine((r) => toMinutes(r.start) < toMinutes(r.end), 'O fim precisa ser depois do início.');

export const scheduleRulesSchema = z
  .array(ruleSchema)
  .max(21)
  .superRefine((rules, ctx) => {
    const sorted = [...rules].sort(
      (a, b) => a.weekday - b.weekday || toMinutes(a.start) - toMinutes(b.start),
    );
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (
        prev &&
        cur &&
        prev.weekday === cur.weekday &&
        toMinutes(cur.start) < toMinutes(prev.end)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: `Faixas sobrepostas em ${WEEKDAY_LABELS[cur.weekday]}.`,
        });
      }
    }
  });

export const blockCreateSchema = z
  .strictObject({ startsAt: instant, endsAt: instant, reason: shortText(3, 200) })
  .refine((b) => new Date(b.endsAt) > new Date(b.startsAt), {
    message: 'O fim precisa ser depois do início.',
    path: ['endsAt'],
  });

export const appointmentCreateSchema = z
  .strictObject({
    scheduleId: id,
    patientId: id,
    startsAt: instant,
    durationMinutes: duration.optional(),
    kind: z.enum(APPOINTMENT_KINDS).default('regular'),
    returnOfId: id.optional(),
    notes: shortText(1, 200).optional(),
    waitlistEntryId: id.optional(),
  })
  .refine((a) => (a.kind === 'return') === (a.returnOfId !== undefined), {
    message: 'Retorno precisa indicar a consulta de origem (e só retorno a indica).',
    path: ['returnOfId'],
  });
export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;

export const appointmentCancelSchema = z.strictObject({
  reason: shortText(3, 200),
  requestedBy: z.enum(['patient', 'clinic']),
});

export const appointmentRescheduleSchema = z.strictObject({
  startsAt: instant,
  scheduleId: id.optional(),
  durationMinutes: duration.optional(),
});

export const appointmentRangeSchema = z
  .strictObject({ from: instant, to: instant })
  .refine((r) => new Date(r.to) > new Date(r.from), 'O fim precisa ser depois do início.')
  .refine(
    (r) => new Date(r.to).getTime() - new Date(r.from).getTime() <= 31 * 24 * 3600_000,
    'Consulte no máximo 31 dias por vez.',
  );

export const availabilityQuerySchema = z.strictObject({
  date: z.iso.date('Data inválida: use AAAA-MM-DD.'),
});

export const waitlistCreateSchema = z.strictObject({
  patientId: id,
  professionalId: id.optional(),
  preference: shortText(1, 200).optional(),
});

export const waitlistRemoveSchema = z.strictObject({ reason: shortText(3, 200) });

export interface ScheduleDto {
  id: string;
  unitId: string;
  professionalId: string;
  professionalName: string;
  slotMinutes: number;
  active: boolean;
  rules: { weekday: number; start: string; end: string }[];
  blocks: { id: string; startsAt: string; endsAt: string; reason: string }[];
}

export interface AppointmentDto {
  id: string;
  scheduleId: string;
  unitId: string;
  professionalId: string;
  patient: { id: string; displayName: string };
  startsAt: string;
  endsAt: string;
  kind: AppointmentKind;
  status: AppointmentStatus;
  notes: string | null;
  returnOfId: string | null;
  rescheduledFromId: string | null;
  rescheduledToId: string | null;
  cancelReason: string | null;
  cancelRequestedBy: 'patient' | 'clinic' | null;
}

export interface AppointmentEventDto {
  type: string;
  at: string;
  by: { id: string; name: string };
  details: Record<string, unknown> | null;
}

export interface WaitlistEntryDto {
  id: string;
  unitId: string;
  patient: { id: string; displayName: string };
  professionalId: string | null;
  preference: string | null;
  status: 'waiting' | 'scheduled' | 'removed';
  createdAt: string;
}
