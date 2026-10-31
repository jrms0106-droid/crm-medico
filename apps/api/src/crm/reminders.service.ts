import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  MESSAGE_MAX_ATTEMPTS,
  type MessageDto,
  type MessageStatus,
  REMINDER_MAX_LEAD_HOURS,
  REMINDER_MIN_LEAD_HOURS,
  maskPhone,
  reminderText,
} from '@crm/shared';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { OutboundMessage, Prisma } from '../generated/prisma/client.js';
import type { AuthContext } from '../identity/session.service.js';
import { toLocal } from '../scheduling/time.js';
import { MessageSender } from './message-sender.js';

const HOUR = 3_600_000;
const ACTIVE_APPOINTMENT = ['scheduled', 'confirmed'] as const;

const firstName = (p: { fullName: string; socialName: string | null }) =>
  (p.socialName ?? p.fullName).trim().split(/\s+/)[0] ?? '';

/** O paciente autorizou lembretes de consulta pelo WhatsApp no cadastro? */
const wantsWhatsappReminders = (p: { commChannels: string[]; appointmentReminders: boolean }) =>
  p.appointmentReminders && p.commChannels.includes('whatsapp');

const messageInclude = {
  patient: { select: { id: true, fullName: true, socialName: true } },
  appointment: {
    select: {
      id: true,
      startsAt: true,
      schedule: { select: { unit: { select: { id: true, name: true } } } },
    },
  },
} satisfies Prisma.OutboundMessageInclude;

type MessageRow = Prisma.OutboundMessageGetPayload<{ include: typeof messageInclude }>;

export interface RunResult {
  planned: number;
  sent: number;
  cancelled: number;
  failed: number;
}

/** Lembretes de consulta (docs/api/crm-e-lembretes.md). */
@Injectable()
export class RemindersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(MessageSender) private readonly sender: MessageSender,
  ) {}

  /** Uma passada da rotina: planeja e envia. */
  async run(): Promise<RunResult> {
    const planned = await this.plan();
    return { planned, ...(await this.dispatch()) };
  }

  /** Cria um lembrete por consulta que começa entre 2 e 24 horas, com autorização e WhatsApp. */
  async plan(): Promise<number> {
    const now = this.clock.now();
    const appointments = await this.prisma.appointment.findMany({
      where: {
        status: { in: [...ACTIVE_APPOINTMENT] },
        startsAt: {
          gt: new Date(now.getTime() + REMINDER_MIN_LEAD_HOURS * HOUR),
          lte: new Date(now.getTime() + REMINDER_MAX_LEAD_HOURS * HOUR),
        },
        messages: { none: { kind: 'appointment_reminder' } },
        patient: {
          active: true,
          appointmentReminders: true,
          commChannels: { has: 'whatsapp' },
          phones: { some: { whatsapp: true } },
        },
      },
      select: {
        id: true,
        organizationId: true,
        unitId: true,
        startsAt: true,
        schedule: { select: { unit: { select: { name: true, timezone: true } } } },
        patient: {
          select: {
            id: true,
            fullName: true,
            socialName: true,
            phones: { where: { whatsapp: true }, orderBy: { position: 'asc' }, take: 1 },
          },
        },
      },
      take: 500,
    });
    let created = 0;
    for (const a of appointments) {
      const phone = a.patient.phones[0];
      if (!phone) continue;
      const unit = a.schedule.unit;
      const local = toLocal(a.startsAt, unit.timezone);
      const time = `${String(Math.floor(local.minute / 60)).padStart(2, '0')}:${String(local.minute % 60).padStart(2, '0')}`;
      const result = await this.prisma.outboundMessage.createMany({
        data: {
          organizationId: a.organizationId,
          unitId: a.unitId,
          patientId: a.patient.id,
          appointmentId: a.id,
          kind: 'appointment_reminder',
          channel: 'whatsapp',
          toNumber: phone.number,
          body: reminderText({
            firstName: firstName(a.patient),
            date: local.date,
            time,
            unit: unit.name,
          }),
          scheduledFor: now,
          createdAt: now,
          updatedAt: now,
        },
        // Duas passadas ao mesmo tempo não criam lembrete repetido (único por consulta e tipo).
        skipDuplicates: true,
      });
      created += result.count;
    }
    return created;
  }

  /** Envia os lembretes na fila, conferindo antes se ainda valem. */
  async dispatch(): Promise<Omit<RunResult, 'planned'>> {
    const now = this.clock.now();
    const queued = await this.prisma.outboundMessage.findMany({
      where: { status: 'queued', scheduledFor: { lte: now } },
      include: {
        appointment: { select: { status: true, startsAt: true } },
        patient: { select: { active: true, commChannels: true, appointmentReminders: true } },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 200,
    });
    const result = { sent: 0, cancelled: 0, failed: 0 };
    for (const m of queued) {
      const reason = this.stillValid(m, now);
      if (reason) {
        await this.finish(m.id, {
          status: 'cancelled',
          cancelReason: reason,
          updatedAt: now,
        });
        result.cancelled++;
        continue;
      }
      try {
        const providerRef = await this.sender.send({
          channel: m.channel,
          toNumber: m.toNumber,
          body: m.body,
        });
        await this.finish(m.id, {
          status: 'sent',
          sentAt: this.clock.now(),
          providerRef,
          attempts: m.attempts + 1,
          updatedAt: this.clock.now(),
        });
        result.sent++;
      } catch (e) {
        const attempts = m.attempts + 1;
        const error = (e instanceof Error ? e.message : 'Falha no envio.').slice(0, 300);
        const final = attempts >= MESSAGE_MAX_ATTEMPTS;
        await this.finish(m.id, {
          status: final ? 'failed' : 'queued',
          attempts,
          lastError: error,
          updatedAt: this.clock.now(),
        });
        if (final) result.failed++;
      }
    }
    return result;
  }

  private stillValid(
    m: OutboundMessage & {
      appointment: { status: string; startsAt: Date };
      patient: { active: boolean; commChannels: string[]; appointmentReminders: boolean };
    },
    now: Date,
  ): string | null {
    if (!(ACTIVE_APPOINTMENT as readonly string[]).includes(m.appointment.status)) {
      return 'A consulta não está mais marcada.';
    }
    if (m.appointment.startsAt.getTime() <= now.getTime()) return 'A consulta já começou.';
    if (!m.patient.active) return 'Cadastro do paciente inativo.';
    if (!wantsWhatsappReminders(m.patient)) return 'O paciente retirou a autorização.';
    return null;
  }

  /** Só muda mensagens ainda na fila (o banco também recusa mudar as finalizadas). */
  private async finish(id: string, data: Prisma.OutboundMessageUpdateManyMutationInput) {
    await this.prisma.outboundMessage.updateMany({ where: { id, status: 'queued' }, data });
  }

  async find(organizationId: string, id: string): Promise<OutboundMessage | null> {
    return this.prisma.outboundMessage.findFirst({ where: { id, organizationId } });
  }

  async list(
    ctx: AuthContext,
    filter: { status?: MessageStatus | undefined; patientId?: string | undefined },
  ): Promise<MessageDto[]> {
    const rows = await this.prisma.outboundMessage.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        unitId: { in: ctx.unitIds },
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.patientId ? { patientId: filter.patientId } : {}),
      },
      include: messageInclude,
      orderBy: [{ appointment: { startsAt: 'desc' } }],
      take: 200,
    });
    return this.dtos(rows);
  }

  async cancel(ctx: AuthContext, message: OutboundMessage, reason: string): Promise<MessageDto> {
    const now = this.clock.now();
    const res = await this.prisma.outboundMessage.updateMany({
      where: { id: message.id, status: 'queued' },
      data: {
        status: 'cancelled',
        cancelReason: reason,
        cancelledByUserId: ctx.user.id,
        updatedAt: now,
      },
    });
    if (res.count === 0) {
      throw new AppError(409, ErrorCode.CONFLICT, 'Só um lembrete na fila pode ser cancelado.');
    }
    const row = await this.prisma.outboundMessage.findUniqueOrThrow({
      where: { id: message.id },
      include: messageInclude,
    });
    const [dto] = await this.dtos([row]);
    return dto as MessageDto;
  }

  private async dtos(rows: MessageRow[]): Promise<MessageDto[]> {
    const ids = [
      ...new Set(rows.flatMap((r) => (r.cancelledByUserId ? [r.cancelledByUserId] : []))),
    ];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    return rows.map((m) => ({
      id: m.id,
      patient: { id: m.patient.id, name: m.patient.socialName ?? m.patient.fullName },
      appointment: { id: m.appointment.id, startsAt: m.appointment.startsAt.toISOString() },
      unit: m.appointment.schedule.unit,
      kind: m.kind,
      channel: m.channel,
      toNumberMasked: maskPhone(m.toNumber),
      body: m.body,
      status: m.status,
      scheduledFor: m.scheduledFor.toISOString(),
      attempts: m.attempts,
      sentAt: m.sentAt?.toISOString() ?? null,
      providerRef: m.providerRef,
      lastError: m.lastError,
      cancelReason: m.cancelReason,
      cancelledBy: m.cancelledByUserId
        ? {
            id: m.cancelledByUserId,
            name: users.find((u) => u.id === m.cancelledByUserId)?.name ?? '',
          }
        : null,
      createdAt: m.createdAt.toISOString(),
    }));
  }
}
