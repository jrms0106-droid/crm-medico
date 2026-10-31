import { Inject, Injectable } from '@nestjs/common';
import {
  type AccessReportDto,
  ErrorCode,
  type PatientExportDto,
  SUBJECT_REQUEST_DEADLINE_DAYS,
  type SubjectRequestDto,
  type accessReportQuerySchema,
  type subjectRequestCreateSchema,
  type subjectRequestListQuerySchema,
  type subjectRequestResolveSchema,
} from '@crm/shared';
import type { z } from 'zod';
import { BillingService } from '../billing/billing.service.js';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { SubjectRequest } from '../generated/prisma/client.js';
import type { AuthContext } from '../identity/session.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { fromLocal } from '../scheduling/time.js';

/** O paciente é da organização, não de uma unidade: datas no fuso de São Paulo. */
const TIMEZONE = 'America/Sao_Paulo';
const DAY_MS = 24 * 3_600_000;
const REPORT_LIMIT = 2000;

/** Data local (AAAA-MM-DD) de um instante. */
function localDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(at);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Pedidos do titular, relatório de acessos e exportação (docs/api/direitos-do-titular.md). */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(PatientsService) private readonly patients: PatientsService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  findPatient(organizationId: string, id: string) {
    return this.patients.find(organizationId, id);
  }

  findRequest(organizationId: string, id: string) {
    return this.prisma.subjectRequest.findFirst({ where: { id, organizationId } });
  }

  async createRequest(
    ctx: AuthContext,
    input: z.infer<typeof subjectRequestCreateSchema>,
  ): Promise<SubjectRequestDto> {
    const now = this.clock.now();
    const row = await this.prisma.subjectRequest.create({
      data: {
        organizationId: ctx.user.organizationId,
        patientId: input.patientId,
        kind: input.kind,
        details: input.details ?? null,
        dueOn: new Date(`${addDays(localDate(now), SUBJECT_REQUEST_DEADLINE_DAYS)}T00:00:00Z`),
        createdByUserId: ctx.user.id,
        createdAt: now,
      },
    });
    return (await this.requestDtos([row]))[0] as SubjectRequestDto;
  }

  async listRequests(
    organizationId: string,
    q: z.infer<typeof subjectRequestListQuerySchema>,
  ): Promise<SubjectRequestDto[]> {
    const rows = await this.prisma.subjectRequest.findMany({
      where: {
        organizationId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.patientId ? { patientId: q.patientId } : {}),
      },
      orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });
    // Abertos primeiro (os mais urgentes no topo); depois os respondidos, mais recentes primeiro.
    const open = rows.filter((r) => r.status === 'open');
    const done = rows
      .filter((r) => r.status !== 'open')
      .sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0));
    return this.requestDtos([...open, ...done]);
  }

  async resolveRequest(
    ctx: AuthContext,
    request: SubjectRequest,
    input: z.infer<typeof subjectRequestResolveSchema>,
  ): Promise<SubjectRequestDto> {
    // Grava só se ainda estiver aberto: duas respostas simultâneas não se sobrepõem.
    const { count } = await this.prisma.subjectRequest.updateMany({
      where: { id: request.id, status: 'open' },
      data: {
        status: input.status,
        resolution: input.resolution,
        resolvedByUserId: ctx.user.id,
        resolvedAt: this.clock.now(),
      },
    });
    if (count === 0) {
      throw new AppError(409, ErrorCode.CONFLICT, 'Este pedido já foi respondido.');
    }
    const row = await this.prisma.subjectRequest.findUniqueOrThrow({ where: { id: request.id } });
    return (await this.requestDtos([row]))[0] as SubjectRequestDto;
  }

  async accessReport(
    organizationId: string,
    patient: { id: string; displayName: string },
    q: z.infer<typeof accessReportQuerySchema>,
  ): Promise<AccessReportDto> {
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        organizationId,
        patientId: patient.id,
        occurredAt: {
          ...(q.from ? { gte: fromLocal(q.from, 0, TIMEZONE) } : {}),
          ...(q.to ? { lt: new Date(fromLocal(q.to, 0, TIMEZONE).getTime() + DAY_MS) } : {}),
        },
      },
      orderBy: { seq: 'desc' },
      take: REPORT_LIMIT + 1,
      select: {
        occurredAt: true,
        actorUserId: true,
        resourceType: true,
        action: true,
        outcome: true,
        emergency: true,
      },
    });
    const truncated = rows.length > REPORT_LIMIT;
    const kept = rows.slice(0, REPORT_LIMIT);
    const actorIds = [...new Set(kept.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true, roles: true },
    });
    return {
      patient: { id: patient.id, name: patient.displayName },
      from: q.from ?? null,
      to: q.to ?? null,
      generatedAt: this.clock.now().toISOString(),
      truncated,
      entries: kept.map((r) => {
        const u = users.find((x) => x.id === r.actorUserId);
        return {
          at: r.occurredAt.toISOString(),
          who: u ? { id: u.id, name: u.name, roles: [...u.roles] } : null,
          resourceType: r.resourceType,
          action: r.action,
          outcome: r.outcome,
          emergency: r.emergency,
        };
      }),
    };
  }

  async exportPatient(ctx: AuthContext, patientId: string): Promise<PatientExportDto> {
    const organizationId = ctx.user.organizationId;
    const patient = await this.patients.find(organizationId, patientId);
    if (!patient) throw new AppError(404, ErrorCode.NOT_FOUND, 'Paciente não encontrado.');
    const [org, appointments, charges, requests] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true },
      }),
      this.prisma.appointment.findMany({
        where: { patientId, schedule: { organizationId } },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          status: true,
          kind: true,
          schedule: {
            select: {
              unit: { select: { name: true } },
              professional: { select: { user: { select: { name: true } } } },
            },
          },
        },
      }),
      this.prisma.charge.findMany({
        where: { organizationId, patientId },
        include: { payments: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.subjectRequest.findMany({
        where: { organizationId, patientId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      format: 'crm-medico/exportacao-do-titular',
      version: 1,
      generatedAt: this.clock.now().toISOString(),
      generatedBy: { id: ctx.user.id, name: ctx.user.name },
      organization: { name: org.name },
      notice:
        'Dados do paciente guardados pela clínica, exportados a pedido do titular (LGPD, art. 18). ' +
        'Documento com dados pessoais: entregue só ao titular ou ao seu representante.',
      patient,
      appointments: appointments.map((a) => ({
        id: a.id,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        status: a.status,
        kind: a.kind,
        unit: a.schedule.unit.name,
        professional: a.schedule.professional.user.name,
      })),
      charges: await this.billing.chargeDtos(charges),
      subjectRequests: await this.requestDtos(requests),
      clinical: {
        included: false,
        reason:
          'A cópia do prontuário e dos documentos médicos é pedida ao médico responsável e ' +
          'entregue à parte.',
      },
    };
  }

  private async requestDtos(rows: SubjectRequest[]): Promise<SubjectRequestDto[]> {
    const userIds = rows.flatMap((r) => [
      r.createdByUserId,
      ...(r.resolvedByUserId ? [r.resolvedByUserId] : []),
    ]);
    const [users, patients] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(userIds)] } },
        select: { id: true, name: true },
      }),
      this.prisma.patient.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.patientId))] } },
        select: { id: true, fullName: true, socialName: true },
      }),
    ]);
    const user = (id: string) => ({ id, name: users.find((u) => u.id === id)?.name ?? '' });
    const today = localDate(this.clock.now());
    return rows.map((r) => {
      const p = patients.find((x) => x.id === r.patientId);
      const dueOn = r.dueOn.toISOString().slice(0, 10);
      return {
        id: r.id,
        patient: { id: r.patientId, name: p ? (p.socialName ?? p.fullName) : '' },
        kind: r.kind,
        details: r.details,
        status: r.status,
        dueOn,
        overdue: r.status === 'open' && today > dueOn,
        createdBy: user(r.createdByUserId),
        createdAt: r.createdAt.toISOString(),
        resolvedBy: r.resolvedByUserId ? user(r.resolvedByUserId) : null,
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolution: r.resolution,
      };
    });
  }
}
