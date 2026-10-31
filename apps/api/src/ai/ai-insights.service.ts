import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_REPORT_MAX_DAYS,
  AI_SIMULATED_NOTICE,
  type AdminReportDto,
  type AdminReportMetrics,
  ErrorCode,
  type ScheduleSuggestionDto,
  type ScheduleSuggestionsDto,
  adminReportOutputSchema,
  type adminReportSchema,
  formatCents,
  formatCount,
  formatPercent,
  numbersIn,
  scheduleSuggestionsOutputSchema,
} from '@crm/shared';
import type { z } from 'zod';
import { BillingService } from '../billing/billing.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthContext } from '../identity/session.service.js';
import { type ScheduleRow, SchedulingService } from '../scheduling/scheduling.service.js';
import { fromLocal, toLocal } from '../scheduling/time.js';
import { AiService, GUARD, block, invalidOutput } from './ai.service.js';
import { LanguageModel, type ModelRequest, type ScheduleFacts } from './language-model.js';

const DAY_MS = 24 * 3_600_000;
const OUTPUT_MAX = 4000;
const WAITLIST_MAX = 30;
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const two = (n: number) => String(n).padStart(2, '0');
const clock = (minute: number) => `${two(Math.floor(minute / 60))}:${two(minute % 60)}`;
const brDate = (iso: string) => iso.split('-').reverse().join('/');
const period = (minute: number): ScheduleFacts['slots'][number]['period'] =>
  minute < 12 * 60 ? 'manhã' : minute < 18 * 60 ? 'tarde' : 'noite';
const displayName = (p: { fullName: string; socialName: string | null }) =>
  p.socialName ?? p.fullName;

const rule = (message: string) => new AppError(422, ErrorCode.BUSINESS_RULE_VIOLATION, message);

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw invalidOutput();
  }
}

/**
 * Organização da agenda e relatório assistido (docs/api/ia-nivel-1.md). O sistema calcula os
 * fatos; o modelo só escolhe entre eles (agenda) ou escreve sobre eles (relatório), e a saída é
 * conferida contra os fatos antes de chegar à tela. Quem chama já conferiu a permissão.
 */
@Injectable()
export class AiInsightsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(LanguageModel) private readonly model: LanguageModel,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  async scheduleSuggestions(
    ctx: AuthContext,
    schedule: ScheduleRow,
    date: string,
  ): Promise<ScheduleSuggestionsDto> {
    await this.ai.requireEnabled(ctx.user.organizationId, 'schedule_suggestions');
    const tz = schedule.unit.timezone;
    const now = this.clock.now();
    const dayStart = fromLocal(date, 0, tz);
    const dayEnd = fromLocal(date, 24 * 60, tz);
    const [free, unconfirmed, waiting] = await Promise.all([
      this.scheduling.availability(schedule, date),
      this.prisma.appointment.findMany({
        where: {
          scheduleId: schedule.id,
          status: 'scheduled',
          startsAt: { gte: now > dayStart ? now : dayStart, lt: dayEnd },
        },
        select: {
          id: true,
          startsAt: true,
          patient: { select: { fullName: true, socialName: true } },
        },
        orderBy: { startsAt: 'asc' },
      }),
      this.prisma.waitlistEntry.findMany({
        where: {
          organizationId: ctx.user.organizationId,
          unitId: schedule.unitId,
          status: 'waiting',
          OR: [{ professionalId: null }, { professionalId: schedule.professionalId }],
        },
        select: {
          id: true,
          professionalId: true,
          preference: true,
          createdAt: true,
          patient: { select: { fullName: true, socialName: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: WAITLIST_MAX,
      }),
    ]);

    // Códigos no lugar das pessoas: o modelo nunca recebe nome, CPF ou telefone.
    const slots = free.map((s, i) => {
      const minute = toLocal(new Date(s.startsAt), tz).minute;
      return { code: `H${i + 1}`, ...s, time: clock(minute), period: period(minute) };
    });
    const entries = waiting.map((w, i) => ({ code: `E${i + 1}`, ...w }));
    const toConfirm = unconfirmed.map((a, i) => ({ code: `C${i + 1}`, ...a }));
    const facts: ScheduleFacts = {
      date: brDate(date),
      slots: slots.map(({ code, time, period: p }) => ({ code, time, period: p })),
      waitlist: entries.map((e) => ({
        code: e.code,
        sameDoctor: e.professionalId === schedule.professionalId,
        waitingDays: Math.max(0, Math.floor((now.getTime() - e.createdAt.getTime()) / DAY_MS)),
        preference: e.preference,
      })),
      unconfirmed: toConfirm.map((a) => ({
        code: a.code,
        time: clock(toLocal(a.startsAt, tz).minute),
      })),
    };
    const fields = { facts: JSON.stringify(facts) };
    const request: ModelRequest = {
      feature: 'schedule_suggestions',
      system: GUARD,
      prompt:
        'Sugira como organizar a agenda do dia. Use só os códigos dos dados. Responda só com JSON ' +
        '{"suggestions": [{"kind": "fill_slot", "slot": "H?", "waitlist": "E?", "reason": "..."} | ' +
        '{"kind": "confirm", "appointment": "C?", "reason": "..."}]}, no máximo 10. Cada horário ' +
        'e cada pessoa no máximo uma vez.\n' +
        block(fields),
      fields,
    };
    const raw = await this.model.complete(request);
    if (raw.length > OUTPUT_MAX) throw invalidOutput();
    const out = scheduleSuggestionsOutputSchema.safeParse(parseJson(raw));
    if (!out.success) throw invalidOutput();

    // Conferência: todo código existe e nenhum horário ou pessoa aparece duas vezes.
    const bySlot = new Map(slots.map((s) => [s.code, s]));
    const byEntry = new Map(entries.map((e) => [e.code, e]));
    const byAppointment = new Map(toConfirm.map((a) => [a.code, a]));
    const seen = new Set<string>();
    const once = (code: string) => {
      if (seen.has(code)) throw invalidOutput();
      seen.add(code);
    };
    const suggestions: ScheduleSuggestionDto[] = out.data.suggestions.map((s) => {
      if (s.kind === 'fill_slot') {
        const slot = bySlot.get(s.slot);
        const entry = byEntry.get(s.waitlist);
        if (!slot || !entry) throw invalidOutput();
        once(s.slot);
        once(s.waitlist);
        return {
          kind: 'fill_slot',
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          waitlistEntryId: entry.id,
          patientName: displayName(entry.patient),
          preference: entry.preference,
          reason: s.reason,
        };
      }
      const appointment = byAppointment.get(s.appointment);
      if (!appointment) throw invalidOutput();
      once(s.appointment);
      return {
        kind: 'confirm',
        appointmentId: appointment.id,
        startsAt: appointment.startsAt.toISOString(),
        patientName: displayName(appointment.patient),
        reason: s.reason,
      };
    });

    // O registro guarda a saída do modelo, que só tem códigos.
    const row = await this.ai.log(ctx, request, date, JSON.stringify(out.data), {
      scheduleId: schedule.id,
      suggestions: suggestions.length,
    });
    return {
      requestId: row.id,
      scheduleId: schedule.id,
      date,
      facts: { freeSlots: slots.length, unconfirmed: toConfirm.length, waiting: entries.length },
      suggestions,
      model: this.ai.modelInfo(row),
      notice: AI_SIMULATED_NOTICE,
    };
  }

  async adminReport(
    ctx: AuthContext,
    q: z.infer<typeof adminReportSchema>,
    timezone: string | null,
  ): Promise<AdminReportDto> {
    const organizationId = ctx.user.organizationId;
    await this.ai.requireEnabled(organizationId, 'admin_report');
    if (q.to < q.from) throw rule('A data final vem antes da inicial.');
    const tz = timezone ?? DEFAULT_TIMEZONE;
    const start = fromLocal(q.from, 0, tz);
    const end = new Date(fromLocal(q.to, 0, tz).getTime() + DAY_MS);
    if (end.getTime() - start.getTime() > (ADMIN_REPORT_MAX_DAYS + 1) * DAY_MS) {
      throw rule(`O período pode ter no máximo ${ADMIN_REPORT_MAX_DAYS} dias.`);
    }
    const metrics = await this.metrics(organizationId, q, start, end);
    const from = brDate(q.from);
    const to = brDate(q.to);
    const fields = { from, to, metrics: JSON.stringify(metrics) };
    const request: ModelRequest = {
      feature: 'admin_report',
      system: GUARD,
      prompt:
        'Escreva até 6 frases curtas de destaque sobre o período, para a gestão da clínica, ' +
        'usando só os números dos dados (valores em centavos viram reais). Responda só com JSON ' +
        '{"highlights": ["..."]}.\n' +
        block(fields),
      fields,
    };
    const raw = await this.model.complete(request);
    if (raw.length > OUTPUT_MAX) throw invalidOutput();
    const out = adminReportOutputSchema.safeParse(parseJson(raw));
    if (!out.success) throw invalidOutput();

    // Nenhum número inventado: todo número do texto precisa ter sido calculado pelo sistema.
    const allowed = allowedNumbers(metrics, [from, to]);
    for (const text of out.data.highlights) {
      if (numbersIn(text).some((n) => !allowed.has(n))) throw invalidOutput();
    }
    const row = await this.ai.log(ctx, request, `${q.from}..${q.to}`, JSON.stringify(out.data), {
      unitId: q.unitId ?? '',
    });
    return {
      requestId: row.id,
      from: q.from,
      to: q.to,
      unitId: q.unitId ?? null,
      metrics,
      highlights: out.data.highlights,
      model: this.ai.modelInfo(row),
      notice: AI_SIMULATED_NOTICE,
    };
  }

  /** Números agregados do período. Nada que identifique um paciente. */
  private async metrics(
    organizationId: string,
    q: z.infer<typeof adminReportSchema>,
    start: Date,
    end: Date,
  ): Promise<AdminReportMetrics> {
    const unit = q.unitId ? { unitId: q.unitId } : {};
    const [byStatus, fitIn, newPatients, waiting, sent, failed, billing] = await Promise.all([
      this.prisma.appointment.groupBy({
        by: ['status'],
        where: { organizationId, ...unit, startsAt: { gte: start, lt: end } },
        _count: { _all: true },
      }),
      this.prisma.appointment.count({
        where: { organizationId, ...unit, kind: 'fit_in', startsAt: { gte: start, lt: end } },
      }),
      this.prisma.patient.count({ where: { organizationId, createdAt: { gte: start, lt: end } } }),
      this.prisma.waitlistEntry.count({ where: { organizationId, ...unit, status: 'waiting' } }),
      this.prisma.outboundMessage.count({
        where: { organizationId, ...unit, status: 'sent', scheduledFor: { gte: start, lt: end } },
      }),
      this.prisma.outboundMessage.count({
        where: { organizationId, ...unit, status: 'failed', scheduledFor: { gte: start, lt: end } },
      }),
      this.billing.report(organizationId, undefined, q),
    ]);
    const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const appointments = {
      total: byStatus.reduce((a, r) => a + r._count._all, 0),
      scheduled: count('scheduled'),
      confirmed: count('confirmed'),
      arrived: count('arrived'),
      cancelled: count('cancelled'),
      noShow: count('no_show'),
      rescheduled: count('rescheduled'),
      fitIn,
    };
    const base = appointments.arrived + appointments.noShow;
    return {
      appointments,
      noShowRate: base === 0 ? null : Math.round((appointments.noShow / base) * 1000) / 10,
      newPatients,
      waiting,
      reminders: { sent, failed },
      billing: {
        netCents: billing.charged.netCents,
        receivedCents: billing.received.totalCents,
        openCents: billing.openCents,
      },
    };
  }
}

/** Todos os números que o texto pode citar, nos formatos em que podem aparecer. */
export function allowedNumbers(m: AdminReportMetrics, dates: string[]): Set<string> {
  const allowed = new Set<string>();
  const add = (text: string) => numbersIn(text).forEach((n) => allowed.add(n));
  const counts = [
    ...Object.values(m.appointments),
    m.newPatients,
    m.waiting,
    m.reminders.sent,
    m.reminders.failed,
  ];
  for (const n of counts) {
    add(formatCount(n));
    add(String(n));
  }
  if (m.noShowRate !== null) add(formatPercent(m.noShowRate));
  for (const cents of Object.values(m.billing)) add(formatCents(cents));
  for (const d of dates) add(d);
  return allowed;
}
