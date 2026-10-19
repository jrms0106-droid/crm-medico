import { Inject, Injectable } from '@nestjs/common';
import type { AccessContext } from '@crm/policy';
import {
  ACTIVE_STATUSES,
  type CareState,
  type EmergencyAccessDto,
  type EncounterDto,
  ErrorCode,
  type emergencyReviewSchema,
} from '@crm/shared';
import type { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config.tokens.js';
import type { AppConfig } from '../config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Encounter, EmergencyAccess } from '../generated/prisma/client.js';
import type { AppointmentRow } from '../scheduling/scheduling.service.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Consultas de ontem para a frente contam para o vínculo de agendado ou confirmado. */
const APPOINTMENT_LOOKBACK = DAY;

export interface CareRelationship {
  state: CareState | null;
  emergencyUntil: Date | null;
}

export const encounterDto = (e: Encounter): EncounterDto => ({
  id: e.id,
  appointmentId: e.appointmentId,
  patientId: e.patientId,
  doctorUserId: e.doctorUserId,
  unitId: e.unitId,
  status: e.status,
  startedAt: e.startedAt.toISOString(),
  closedAt: e.closedAt?.toISOString() ?? null,
  followUpUntil: e.followUpUntil?.toISOString() ?? null,
});

/** Recusa da restrição `encounters_one_open_per_doctor_patient` (código 23P01). */
function isOpenEncounterViolation(error: unknown): boolean {
  const text = (() => {
    try {
      return JSON.stringify(error, Object.getOwnPropertyNames(error ?? {}));
    } catch {
      return String(error);
    }
  })();
  return text.includes('encounters_one_open_per_doctor_patient') || text.includes('23P01');
}

/**
 * Atendimentos, vínculo assistencial e acesso emergencial (docs/api/atendimento-e-vinculo.md).
 * O vínculo não é gravado: é calculado a cada pedido, para nunca ficar desatualizado.
 */
@Injectable()
export class CareService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Estado do vínculo entre um médico e um paciente agora. Vale o primeiro estado que se aplica. */
  async relationship(
    organizationId: string,
    doctorUserId: string,
    patientId: string,
  ): Promise<CareRelationship> {
    const now = this.clock.now();
    const pair = { organizationId, doctorUserId, patientId };
    const [open, followUp, courtesy, anyEncounter, appointments, emergency] = await Promise.all([
      this.prisma.encounter.count({ where: { ...pair, status: 'started' } }),
      this.prisma.encounter.count({ where: { ...pair, followUpUntil: { gt: now } } }),
      this.prisma.encounter.count({
        where: {
          ...pair,
          status: 'closed',
          closedAt: { gt: new Date(now.getTime() - this.config.CARE_COURTESY_DAYS * DAY) },
        },
      }),
      this.prisma.encounter.count({ where: pair }),
      this.prisma.appointment.findMany({
        where: {
          organizationId,
          patientId,
          status: { in: [...ACTIVE_STATUSES] },
          startsAt: { gte: new Date(now.getTime() - APPOINTMENT_LOOKBACK) },
          schedule: { professional: { userId: doctorUserId } },
        },
        select: { status: true },
      }),
      this.prisma.emergencyAccess.findFirst({
        where: {
          organizationId,
          userId: doctorUserId,
          patientId,
          startsAt: { lte: now },
          expiresAt: { gt: now },
        },
        orderBy: { expiresAt: 'desc' },
        select: { expiresAt: true },
      }),
    ]);
    const state: CareState | null =
      open > 0
        ? 'started'
        : followUp > 0
          ? 'follow_up'
          : courtesy > 0
            ? 'closed'
            : appointments.some((a) => a.status !== 'scheduled')
              ? 'confirmed'
              : appointments.length > 0
                ? 'scheduled'
                : anyEncounter > 0
                  ? 'expired'
                  : null;
    return { state, emergencyUntil: emergency?.expiresAt ?? null };
  }

  /** Contexto da política para um médico e um paciente. */
  async accessContext(
    organizationId: string,
    doctorUserId: string,
    patientId: string,
  ): Promise<AccessContext> {
    const r = await this.relationship(organizationId, doctorUserId, patientId);
    return {
      careRelationship: r.state ?? undefined,
      emergencyAccess: r.emergencyUntil !== null,
    };
  }

  // Atendimentos

  async findEncounter(organizationId: string, id: string): Promise<Encounter | null> {
    return this.prisma.encounter.findFirst({ where: { id, organizationId } });
  }

  async startEncounter(appointment: AppointmentRow, doctorUserId: string): Promise<EncounterDto> {
    if (appointment.status !== 'arrived') {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE_TRANSITION,
        'O atendimento só começa depois que a recepção marca a chegada do paciente.',
      );
    }
    const existing = await this.prisma.encounter.count({
      where: { appointmentId: appointment.id },
    });
    if (existing > 0) {
      throw new AppError(409, ErrorCode.CONFLICT, 'Esta consulta já tem um atendimento.');
    }
    try {
      const created = await this.prisma.encounter.create({
        data: {
          organizationId: appointment.organizationId,
          unitId: appointment.unitId,
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          doctorUserId,
          startedAt: this.clock.now(),
        },
      });
      return encounterDto(created);
    } catch (error) {
      if (isOpenEncounterViolation(error)) {
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          'Você já tem um atendimento aberto com este paciente. Encerre-o antes de iniciar outro.',
        );
      }
      throw error;
    }
  }

  async closeEncounter(encounter: Encounter, followUpDays?: number): Promise<EncounterDto> {
    const now = this.clock.now();
    const { count } = await this.prisma.encounter.updateMany({
      where: { id: encounter.id, status: 'started' },
      data: {
        status: 'closed',
        closedAt: now,
        followUpUntil: followUpDays ? new Date(now.getTime() + followUpDays * DAY) : null,
      },
    });
    if (count !== 1) {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE_TRANSITION,
        'O atendimento já foi encerrado.',
      );
    }
    return encounterDto(
      await this.prisma.encounter.findUniqueOrThrow({ where: { id: encounter.id } }),
    );
  }

  // Acesso emergencial

  async patientExists(organizationId: string, patientId: string): Promise<boolean> {
    return (await this.prisma.patient.count({ where: { id: patientId, organizationId } })) > 0;
  }

  async grantEmergency(
    organizationId: string,
    userId: string,
    patientId: string,
    justification: string,
  ): Promise<EmergencyAccessDto> {
    const now = this.clock.now();
    const created = await this.prisma.emergencyAccess.create({
      data: {
        organizationId,
        userId,
        patientId,
        justification,
        startsAt: now,
        expiresAt: new Date(now.getTime() + this.config.EMERGENCY_ACCESS_HOURS * HOUR),
      },
    });
    return (await this.emergencyDtos([created]))[0] as EmergencyAccessDto;
  }

  async findEmergency(organizationId: string, id: string): Promise<EmergencyAccess | null> {
    return this.prisma.emergencyAccess.findFirst({ where: { id, organizationId } });
  }

  async listEmergencies(
    organizationId: string,
    status: 'pending' | 'reviewed',
  ): Promise<EmergencyAccessDto[]> {
    const rows = await this.prisma.emergencyAccess.findMany({
      where: { organizationId, reviewedAt: status === 'pending' ? null : { not: null } },
      orderBy: { startsAt: status === 'pending' ? 'asc' : 'desc' },
      take: 200,
    });
    return this.emergencyDtos(rows);
  }

  async review(
    access: EmergencyAccess,
    reviewerId: string,
    input: z.infer<typeof emergencyReviewSchema>,
  ): Promise<EmergencyAccessDto> {
    const { count } = await this.prisma.emergencyAccess.updateMany({
      where: { id: access.id, reviewedAt: null },
      data: {
        reviewOutcome: input.outcome,
        reviewNotes: input.notes,
        reviewedAt: this.clock.now(),
        reviewedByUserId: reviewerId,
      },
    });
    if (count !== 1) {
      throw new AppError(409, ErrorCode.INVALID_STATE_TRANSITION, 'Este acesso já foi revisado.');
    }
    const row = await this.prisma.emergencyAccess.findUniqueOrThrow({ where: { id: access.id } });
    return (await this.emergencyDtos([row]))[0] as EmergencyAccessDto;
  }

  private async emergencyDtos(rows: EmergencyAccess[]): Promise<EmergencyAccessDto[]> {
    const ids = new Set(rows.flatMap((r) => [r.userId, r.reviewedByUserId ?? r.userId]));
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    const name = (id: string) => ({ id, name: users.find((u) => u.id === id)?.name ?? '' });
    const now = this.clock.now();
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      requestedBy: name(r.userId),
      justification: r.justification,
      startsAt: r.startsAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      active: r.startsAt <= now && now < r.expiresAt,
      review:
        r.reviewedAt && r.reviewOutcome && r.reviewedByUserId
          ? {
              outcome: r.reviewOutcome,
              notes: r.reviewNotes ?? '',
              reviewedAt: r.reviewedAt.toISOString(),
              reviewedBy: name(r.reviewedByUserId),
            }
          : null,
    }));
  }
}
