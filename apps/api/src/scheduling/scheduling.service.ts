import { Inject, Injectable } from '@nestjs/common';
import {
  ACTIVE_STATUSES,
  type AppointmentCreateInput,
  type AppointmentDto,
  type AppointmentEventDto,
  type AppointmentStatus,
  ErrorCode,
  type ScheduleDto,
  type WaitlistEntryDto,
  type appointmentCancelSchema,
  type appointmentRescheduleSchema,
  type blockCreateSchema,
  type scheduleCreateSchema,
  type scheduleRulesSchema,
  type scheduleUpdateSchema,
  type waitlistCreateSchema,
  displayName,
  fromMinutes,
  toMinutes,
} from '@crm/shared';
import type { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { fromLocal, toLocal, weekdayOf } from './time.js';

const MINUTE = 60_000;
const CHECK_IN_WINDOW = 120 * MINUTE;

const SCHEDULE_INCLUDE = {
  unit: { select: { timezone: true, active: true } },
  professional: { select: { userId: true, active: true, user: { select: { name: true } } } },
  rules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
} as const satisfies Prisma.ScheduleInclude;

export type ScheduleRow = Prisma.ScheduleGetPayload<{ include: typeof SCHEDULE_INCLUDE }>;

const APPOINTMENT_INCLUDE = {
  patient: { select: { id: true, fullName: true, socialName: true } },
  schedule: { select: { professionalId: true, professional: { select: { userId: true } } } },
} as const satisfies Prisma.AppointmentInclude;

export type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof APPOINTMENT_INCLUDE }>;

const WAITLIST_INCLUDE = {
  patient: { select: { id: true, fullName: true, socialName: true } },
} as const satisfies Prisma.WaitlistEntryInclude;

type WaitlistRow = Prisma.WaitlistEntryGetPayload<{ include: typeof WAITLIST_INCLUDE }>;

type Tx = Prisma.TransactionClient;

const rule = (message: string, code: ErrorCode = ErrorCode.BUSINESS_RULE_VIOLATION) =>
  new AppError(422, code, message);
const conflict = (code: ErrorCode, message: string) => new AppError(409, code, message);
const invalidTransition = () =>
  conflict(
    ErrorCode.INVALID_STATE_TRANSITION,
    'A consulta não está num estado que permita esta operação.',
  );

/** Transições permitidas: estado de destino → estados de origem (docs/api/agenda.md). */
const FROM: Record<
  'confirmed' | 'arrived' | 'no_show' | 'cancelled' | 'rescheduled',
  AppointmentStatus[]
> = {
  confirmed: ['scheduled'],
  arrived: ['scheduled', 'confirmed'],
  no_show: ['scheduled', 'confirmed'],
  cancelled: ['scheduled', 'confirmed'],
  rescheduled: ['scheduled', 'confirmed'],
};

const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart < bEnd && bStart < aEnd;

/** Recusa da restrição `appointments_no_overlap` (código 23P01 do PostgreSQL). */
export function isOverlapViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null || seen.has(value) || depth > 6) return false;
    seen.add(value);
    const v = value as Record<string, unknown>;
    if (v['code'] === '23P01' || v['originalCode'] === '23P01') return true;
    if (typeof v['message'] === 'string' && v['message'].includes('appointments_no_overlap')) {
      return true;
    }
    return Object.values(v).some((child) => visit(child, depth + 1));
  };
  return visit(error, 0);
}

const slotTaken = () =>
  conflict(ErrorCode.SLOT_TAKEN, 'Esse horário já está ocupado por outra consulta.');

export const appointmentDto = (a: AppointmentRow): AppointmentDto => ({
  id: a.id,
  scheduleId: a.scheduleId,
  unitId: a.unitId,
  professionalId: a.schedule.professionalId,
  patient: { id: a.patient.id, displayName: displayName(a.patient) },
  startsAt: a.startsAt.toISOString(),
  endsAt: a.endsAt.toISOString(),
  kind: a.kind,
  status: a.status,
  notes: a.notes,
  returnOfId: a.returnOfId,
  rescheduledFromId: a.rescheduledFromId,
  rescheduledToId: a.rescheduledToId,
  cancelReason: a.cancelReason,
  cancelRequestedBy: a.cancelRequestedBy as AppointmentDto['cancelRequestedBy'],
});

const waitlistDto = (w: WaitlistRow): WaitlistEntryDto => ({
  id: w.id,
  unitId: w.unitId,
  patient: { id: w.patient.id, displayName: displayName(w.patient) },
  professionalId: w.professionalId,
  preference: w.preference,
  status: w.status,
  createdAt: w.createdAt.toISOString(),
});

interface Booking {
  schedule: ScheduleRow;
  patientId: string;
  startsAt: Date;
  durationMinutes: number;
  kind: AppointmentCreateInput['kind'];
}

/**
 * Agendas, consultas e lista de espera. Toda consulta ao banco é restrita à organização
 * informada; a permissão é conferida antes, no controller.
 */
@Injectable()
export class SchedulingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  // Agendas

  async findUnit(organizationId: string, unitId: string) {
    return this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
  }

  async findSchedule(organizationId: string, id: string): Promise<ScheduleRow | null> {
    return this.prisma.schedule.findFirst({
      where: { id, organizationId },
      include: SCHEDULE_INCLUDE,
    });
  }

  async listSchedules(organizationId: string, unitId: string): Promise<ScheduleDto[]> {
    const rows = await this.prisma.schedule.findMany({
      where: { organizationId, unitId },
      include: SCHEDULE_INCLUDE,
    });
    const dtos = await Promise.all(rows.map((r) => this.scheduleDto(r)));
    return dtos.sort((a, b) => a.professionalName.localeCompare(b.professionalName, 'pt-BR'));
  }

  async createSchedule(
    organizationId: string,
    unitId: string,
    input: z.infer<typeof scheduleCreateSchema>,
  ): Promise<ScheduleDto> {
    const professional = await this.prisma.professional.findFirst({
      where: { id: input.professionalId, organizationId },
      include: { user: { select: { active: true, unitMemberships: { where: { unitId } } } } },
    });
    if (!professional?.active || !professional.user.active) {
      throw rule('Profissional não encontrado ou inativo.');
    }
    if (professional.user.unitMemberships.length === 0) {
      throw rule('O profissional não pertence a esta unidade.');
    }
    // Grava sem `include` e relê: com `include`, o Prisma faria leituras paralelas numa
    // transação implícita, o que o driver `pg` desaconselha.
    const { id } = await this.prisma.schedule.create({
      data: {
        organizationId,
        unitId,
        professionalId: professional.id,
        slotMinutes: input.slotMinutes,
      },
      select: { id: true },
    });
    return this.reloadSchedule(id);
  }

  async updateSchedule(
    schedule: ScheduleRow,
    input: z.infer<typeof scheduleUpdateSchema>,
  ): Promise<ScheduleDto> {
    await this.prisma.schedule.update({
      where: { id: schedule.id },
      data: input,
      select: { id: true },
    });
    return this.reloadSchedule(schedule.id);
  }

  async replaceRules(
    schedule: ScheduleRow,
    rules: z.infer<typeof scheduleRulesSchema>,
  ): Promise<ScheduleDto> {
    await this.prisma.$transaction(async (tx) => {
      await tx.scheduleRule.deleteMany({ where: { scheduleId: schedule.id } });
      await tx.scheduleRule.createMany({
        data: rules.map((r) => ({
          scheduleId: schedule.id,
          weekday: r.weekday,
          startMinute: toMinutes(r.start),
          endMinute: toMinutes(r.end),
        })),
      });
    });
    return this.reloadSchedule(schedule.id);
  }

  async createBlock(
    schedule: ScheduleRow,
    userId: string,
    input: z.infer<typeof blockCreateSchema>,
  ): Promise<ScheduleDto['blocks'][number]> {
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const booked = await this.prisma.appointment.count({
      where: {
        scheduleId: schedule.id,
        status: { in: [...ACTIVE_STATUSES] },
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    if (booked > 0) {
      throw conflict(
        ErrorCode.BLOCK_HAS_APPOINTMENTS,
        `Há ${booked} consulta(s) marcada(s) nesse período. Reagende ou cancele antes de bloquear.`,
      );
    }
    const block = await this.prisma.scheduleBlock.create({
      data: {
        scheduleId: schedule.id,
        startsAt,
        endsAt,
        reason: input.reason,
        createdByUserId: userId,
      },
    });
    return {
      id: block.id,
      startsAt: block.startsAt.toISOString(),
      endsAt: block.endsAt.toISOString(),
      reason: block.reason,
    };
  }

  /** Marca o bloqueio como removido; devolve `false` se não existe ou já foi removido. */
  async removeBlock(schedule: ScheduleRow, blockId: string, userId: string): Promise<boolean> {
    const { count } = await this.prisma.scheduleBlock.updateMany({
      where: { id: blockId, scheduleId: schedule.id, removedAt: null },
      data: { removedAt: this.clock.now(), removedByUserId: userId },
    });
    return count === 1;
  }

  /** Horários livres do dia na duração padrão (docs/api/agenda.md, "Disponibilidade"). */
  async availability(
    schedule: ScheduleRow,
    date: string,
  ): Promise<{ startsAt: string; endsAt: string }[]> {
    const tz = schedule.unit.timezone;
    const weekday = weekdayOf(date);
    const dayStart = fromLocal(date, 0, tz);
    const dayEnd = fromLocal(date, 24 * 60, tz);
    const [blocks, booked] = await Promise.all([
      this.activeBlocks(this.prisma, schedule.id, dayStart, dayEnd),
      this.prisma.appointment.findMany({
        where: {
          scheduleId: schedule.id,
          status: { in: [...ACTIVE_STATUSES] },
          kind: { not: 'fit_in' },
          startsAt: { lt: dayEnd },
          endsAt: { gt: dayStart },
        },
        select: { startsAt: true, endsAt: true },
      }),
    ]);
    const now = this.clock.now();
    const busy = [...blocks, ...booked];
    const free: { startsAt: string; endsAt: string }[] = [];
    for (const r of schedule.rules.filter((x) => x.weekday === weekday)) {
      for (
        let m = r.startMinute;
        m + schedule.slotMinutes <= r.endMinute;
        m += schedule.slotMinutes
      ) {
        const startsAt = fromLocal(date, m, tz);
        const endsAt = fromLocal(date, m + schedule.slotMinutes, tz);
        if (startsAt < now) continue;
        if (busy.some((b) => overlaps(startsAt, endsAt, b.startsAt, b.endsAt))) continue;
        free.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
      }
    }
    return free;
  }

  // Consultas

  async findAppointment(organizationId: string, id: string): Promise<AppointmentRow | null> {
    return this.prisma.appointment.findFirst({
      where: { id, organizationId },
      include: APPOINTMENT_INCLUDE,
    });
  }

  async listAppointments(schedule: ScheduleRow, from: Date, to: Date): Promise<AppointmentDto[]> {
    const rows = await this.prisma.appointment.findMany({
      where: { scheduleId: schedule.id, startsAt: { lt: to }, endsAt: { gt: from } },
      include: APPOINTMENT_INCLUDE,
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(appointmentDto);
  }

  async createAppointment(
    organizationId: string,
    userId: string,
    schedule: ScheduleRow,
    input: AppointmentCreateInput,
  ): Promise<AppointmentDto> {
    const durationMinutes = input.durationMinutes ?? schedule.slotMinutes;
    const startsAt = new Date(input.startsAt);
    await this.checkPatient(organizationId, input.patientId);
    if (input.returnOfId) {
      const origin = await this.prisma.appointment.findFirst({
        where: { id: input.returnOfId, organizationId, patientId: input.patientId },
        select: { startsAt: true },
      });
      if (!origin || origin.startsAt >= startsAt) {
        throw rule('O retorno precisa apontar uma consulta anterior do mesmo paciente.');
      }
    }
    if (input.waitlistEntryId) {
      const entry = await this.prisma.waitlistEntry.findFirst({
        where: { id: input.waitlistEntryId, organizationId },
      });
      if (
        !entry ||
        entry.status !== 'waiting' ||
        entry.patientId !== input.patientId ||
        entry.unitId !== schedule.unitId
      ) {
        throw rule(
          'A entrada da lista de espera não está aguardando para este paciente e unidade.',
        );
      }
    }
    const created = await this.withOverlapGuard(() =>
      this.prisma.$transaction(async (tx) => {
        const id = await this.book(
          tx,
          userId,
          {
            schedule,
            patientId: input.patientId,
            startsAt,
            durationMinutes,
            kind: input.kind,
          },
          {
            returnOfId: input.returnOfId ?? null,
            notes: input.notes ?? null,
          },
          { waitlistEntryId: input.waitlistEntryId ?? null },
        );
        if (input.waitlistEntryId) {
          const { count } = await tx.waitlistEntry.updateMany({
            where: { id: input.waitlistEntryId, status: 'waiting' },
            data: { status: 'scheduled', appointmentId: id },
          });
          if (count !== 1) throw rule('A entrada da lista de espera já foi atendida.');
        }
        return id;
      }),
    );
    return appointmentDto(
      await this.prisma.appointment.findUniqueOrThrow({
        where: { id: created },
        include: APPOINTMENT_INCLUDE,
      }),
    );
  }

  async confirm(appointment: AppointmentRow, userId: string): Promise<AppointmentDto> {
    return this.transition(appointment, userId, 'confirmed', {});
  }

  async checkIn(appointment: AppointmentRow, userId: string): Promise<AppointmentDto> {
    if (this.clock.now().getTime() < appointment.startsAt.getTime() - CHECK_IN_WINDOW) {
      throw rule('A presença só pode ser marcada a partir de 2 horas antes do horário.');
    }
    return this.transition(appointment, userId, 'arrived', {});
  }

  async noShow(appointment: AppointmentRow, userId: string): Promise<AppointmentDto> {
    if (this.clock.now() < appointment.startsAt) {
      throw rule('A falta só pode ser marcada depois do horário de início.');
    }
    return this.transition(appointment, userId, 'no_show', {});
  }

  async cancel(
    appointment: AppointmentRow,
    userId: string,
    input: z.infer<typeof appointmentCancelSchema>,
  ): Promise<AppointmentDto> {
    return this.transition(
      appointment,
      userId,
      'cancelled',
      { cancelReason: input.reason, cancelRequestedBy: input.requestedBy },
      { reason: input.reason, requestedBy: input.requestedBy },
    );
  }

  /**
   * Cria a consulta nova e marca a antiga como reagendada, numa única transação: se o novo
   * horário for recusado, a consulta original fica como estava.
   */
  async reschedule(
    appointment: AppointmentRow,
    userId: string,
    target: ScheduleRow,
    input: z.infer<typeof appointmentRescheduleSchema>,
  ): Promise<AppointmentDto> {
    const durationMinutes =
      input.durationMinutes ??
      (target.id === appointment.scheduleId
        ? Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / MINUTE)
        : target.slotMinutes);
    const startsAt = new Date(input.startsAt);
    const created = await this.withOverlapGuard(() =>
      this.prisma.$transaction(async (tx) => {
        const now = this.clock.now();
        const { count } = await tx.appointment.updateMany({
          where: { id: appointment.id, status: { in: FROM.rescheduled } },
          data: { status: 'rescheduled' },
        });
        if (count !== 1) throw invalidTransition();
        const id = await this.book(
          tx,
          userId,
          {
            schedule: target,
            patientId: appointment.patientId,
            startsAt,
            durationMinutes,
            kind: appointment.kind,
          },
          {
            returnOfId: appointment.returnOfId,
            notes: appointment.notes,
            rescheduledFromId: appointment.id,
          },
          { rescheduledFromId: appointment.id },
        );
        await tx.appointment.update({
          where: { id: appointment.id },
          data: { rescheduledToId: id },
        });
        await tx.appointmentEvent.create({
          data: {
            appointmentId: appointment.id,
            type: 'rescheduled',
            at: now,
            byUserId: userId,
            details: { toId: id, startsAt: startsAt.toISOString() },
          },
        });
        return id;
      }),
    );
    return appointmentDto(
      await this.prisma.appointment.findUniqueOrThrow({
        where: { id: created },
        include: APPOINTMENT_INCLUDE,
      }),
    );
  }

  async history(appointmentId: string): Promise<AppointmentEventDto[]> {
    const events = await this.prisma.appointmentEvent.findMany({
      where: { appointmentId },
      orderBy: { seq: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(events.map((e) => e.byUserId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return events.map((e) => ({
      type: e.type,
      at: e.at.toISOString(),
      by: { id: e.byUserId, name: names.get(e.byUserId) ?? '' },
      details: (e.details as Record<string, unknown> | null) ?? null,
    }));
  }

  // Lista de espera

  async listWaitlist(organizationId: string, unitId: string): Promise<WaitlistEntryDto[]> {
    const rows = await this.prisma.waitlistEntry.findMany({
      where: { organizationId, unitId, status: 'waiting' },
      include: WAITLIST_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(waitlistDto);
  }

  async findWaitlistEntry(organizationId: string, id: string) {
    return this.prisma.waitlistEntry.findFirst({ where: { id, organizationId } });
  }

  async addToWaitlist(
    organizationId: string,
    unitId: string,
    userId: string,
    input: z.infer<typeof waitlistCreateSchema>,
  ): Promise<WaitlistEntryDto> {
    await this.checkPatient(organizationId, input.patientId);
    if (input.professionalId) {
      const professional = await this.prisma.professional.findFirst({
        where: { id: input.professionalId, organizationId, active: true },
      });
      if (!professional) throw rule('Profissional não encontrado ou inativo.');
    }
    const waiting = await this.prisma.waitlistEntry.count({
      where: { unitId, patientId: input.patientId, status: 'waiting' },
    });
    if (waiting > 0) {
      throw conflict(ErrorCode.CONFLICT, 'O paciente já está na lista de espera desta unidade.');
    }
    const entry = await this.prisma.waitlistEntry.create({
      data: {
        organizationId,
        unitId,
        patientId: input.patientId,
        professionalId: input.professionalId ?? null,
        preference: input.preference ?? null,
        createdByUserId: userId,
      },
      include: WAITLIST_INCLUDE,
    });
    return waitlistDto(entry);
  }

  async removeFromWaitlist(entryId: string, reason: string): Promise<void> {
    const { count } = await this.prisma.waitlistEntry.updateMany({
      where: { id: entryId, status: 'waiting' },
      data: { status: 'removed', removedReason: reason },
    });
    if (count !== 1) {
      throw conflict(ErrorCode.INVALID_STATE_TRANSITION, 'Esta entrada não está mais aguardando.');
    }
  }

  // Apoio

  private async reloadSchedule(id: string): Promise<ScheduleDto> {
    return this.scheduleDto(
      await this.prisma.schedule.findUniqueOrThrow({ where: { id }, include: SCHEDULE_INCLUDE }),
    );
  }

  private async scheduleDto(s: ScheduleRow): Promise<ScheduleDto> {
    const blocks = await this.prisma.scheduleBlock.findMany({
      where: { scheduleId: s.id, removedAt: null, endsAt: { gt: this.clock.now() } },
      orderBy: { startsAt: 'asc' },
    });
    return {
      id: s.id,
      unitId: s.unitId,
      professionalId: s.professionalId,
      professionalName: s.professional.user.name,
      slotMinutes: s.slotMinutes,
      active: s.active,
      rules: s.rules.map((r) => ({
        weekday: r.weekday,
        start: fromMinutes(r.startMinute),
        end: fromMinutes(r.endMinute),
      })),
      blocks: blocks.map((b) => ({
        id: b.id,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
        reason: b.reason,
      })),
    };
  }

  private async checkPatient(organizationId: string, patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, organizationId, active: true },
      select: { id: true },
    });
    if (!patient) throw rule('Paciente não encontrado ou inativo.');
  }

  private activeBlocks(db: Tx | PrismaService, scheduleId: string, from: Date, to: Date) {
    return db.scheduleBlock.findMany({
      where: { scheduleId, removedAt: null, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true },
    });
  }

  /**
   * Confere as regras de marcação (docs/api/agenda.md, "Regras ao marcar") e grava a consulta
   * com o evento de criação. A sobreposição na agenda é barrada também pelo banco.
   */
  private async book(
    tx: Tx,
    userId: string,
    b: Booking,
    extra: { returnOfId: string | null; notes: string | null; rescheduledFromId?: string },
    eventDetails: Record<string, string | null>,
  ): Promise<string> {
    const { schedule, startsAt } = b;
    if (!schedule.active || !schedule.unit.active || !schedule.professional.active) {
      throw rule('Esta agenda está desativada.');
    }
    const now = this.clock.now();
    if (startsAt < now) throw rule('Não é possível marcar consulta no passado.');
    if (startsAt.getTime() % (5 * MINUTE) !== 0) {
      throw rule('O início precisa ser múltiplo de 5 minutos.');
    }
    const endsAt = new Date(startsAt.getTime() + b.durationMinutes * MINUTE);
    const local = toLocal(startsAt, schedule.unit.timezone);
    const endMinute = local.minute + b.durationMinutes;
    const fits = schedule.rules.some(
      (r) =>
        r.weekday === local.weekday && r.startMinute <= local.minute && endMinute <= r.endMinute,
    );
    if (!fits) {
      throw rule('Fora do horário de atendimento desta agenda.', ErrorCode.OUTSIDE_WORKING_HOURS);
    }
    if ((await this.activeBlocks(tx, schedule.id, startsAt, endsAt)).length > 0) {
      throw rule('Esse horário está bloqueado na agenda.', ErrorCode.SLOT_BLOCKED);
    }

    // Serializa as marcações da mesma agenda e do mesmo paciente (sempre nesta ordem), para as
    // checagens abaixo valerem sob concorrência. Sem a trava da agenda, inserções simultâneas
    // sobrepostas podem travar entre si na restrição do banco (deadlock) em vez de serem recusadas.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${schedule.id}::text, 0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${b.patientId}::text, 0))`;
    const active = {
      status: { in: [...ACTIVE_STATUSES] },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    };
    if (b.kind !== 'fit_in') {
      const taken = await tx.appointment.count({
        where: { ...active, scheduleId: schedule.id, kind: { not: 'fit_in' } },
      });
      if (taken > 0) throw slotTaken();
    }
    const patientBusy = await tx.appointment.count({
      where: { ...active, patientId: b.patientId },
    });
    if (patientBusy > 0) {
      throw conflict(
        ErrorCode.PATIENT_DOUBLE_BOOKED,
        'O paciente já tem outra consulta nesse horário.',
      );
    }

    const created = await tx.appointment.create({
      data: {
        organizationId: schedule.organizationId,
        unitId: schedule.unitId,
        scheduleId: schedule.id,
        patientId: b.patientId,
        startsAt,
        endsAt,
        kind: b.kind,
        notes: extra.notes,
        returnOfId: extra.returnOfId,
        rescheduledFromId: extra.rescheduledFromId ?? null,
        createdByUserId: userId,
      },
      select: { id: true },
    });
    await tx.appointmentEvent.create({
      data: {
        appointmentId: created.id,
        type: 'created',
        at: now,
        byUserId: userId,
        details: {
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          kind: b.kind,
          ...eventDetails,
        },
      },
    });
    return created.id;
  }

  private async withOverlapGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isOverlapViolation(error)) throw slotTaken();
      throw error;
    }
  }

  private async transition(
    appointment: AppointmentRow,
    userId: string,
    to: keyof typeof FROM,
    data: Prisma.AppointmentUpdateManyMutationInput,
    details: Record<string, string> | null = null,
  ): Promise<AppointmentDto> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.appointment.updateMany({
        where: { id: appointment.id, status: { in: FROM[to] } },
        data: { ...data, status: to },
      });
      if (count !== 1) throw invalidTransition();
      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          type: to,
          at: this.clock.now(),
          byUserId: userId,
          ...(details ? { details } : {}),
        },
      });
    });
    return appointmentDto(
      await this.prisma.appointment.findUniqueOrThrow({
        where: { id: appointment.id },
        include: APPOINTMENT_INCLUDE,
      }),
    );
  }
}
