import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type ExternalDocumentCreateInput,
  type ExternalDocumentDto,
  type ExternalPlatform,
  type MemedPrescriptionInput,
  memedPrescriptionSummary,
} from '@crm/shared';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ExternalDocument } from '../generated/prisma/client.js';
import type { AuthContext } from '../identity/session.service.js';
import { toLocal } from '../scheduling/time.js';
import { PrescriptionProvider } from './prescription-provider.js';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

const noProfessional = () =>
  new AppError(
    422,
    ErrorCode.BUSINESS_RULE_VIOLATION,
    'Seu registro profissional (CRM) não está cadastrado ou está inativo. Peça ao administrador.',
  );

/**
 * Registro de documentos emitidos na plataforma do CFM (docs/api/documentos-externos.md).
 * Só grava e lê; quem decide o acesso é o controlador, pela política. O banco recusa apagar e
 * qualquer alteração além do cancelamento (gatilho `documents.protect_external_document`).
 */
@Injectable()
export class ExternalDocumentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(PrescriptionProvider) private readonly prescriptions: PrescriptionProvider,
  ) {}

  async find(organizationId: string, id: string): Promise<ExternalDocument | null> {
    return this.prisma.externalDocument.findFirst({ where: { id, organizationId } });
  }

  async create(
    ctx: AuthContext,
    patientId: string,
    input: ExternalDocumentCreateInput,
  ): Promise<ExternalDocumentDto> {
    const org = ctx.user.organizationId;
    const professional = await this.prisma.professional.count({
      where: { organizationId: org, userId: ctx.user.id, active: true },
    });
    if (!professional) {
      throw new AppError(
        422,
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Seu registro profissional (CRM) não está cadastrado ou está inativo. Peça ao administrador.',
      );
    }
    const encounter = await this.prisma.encounter.findFirst({
      where: { organizationId: org, doctorUserId: ctx.user.id, patientId, status: 'started' },
      select: { id: true, unitId: true },
    });
    const unit = encounter?.unitId
      ? await this.prisma.unit.findUnique({
          where: { id: encounter.unitId },
          select: { timezone: true },
        })
      : null;
    const today = toLocal(this.clock.now(), unit?.timezone ?? DEFAULT_TIMEZONE).date;
    if (input.issuedOn > today) {
      throw new AppError(
        422,
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'A data de emissão está no futuro.',
        [{ field: 'issuedOn', issue: 'A data de emissão não pode ser depois de hoje.' }],
      );
    }
    const created = await this.prisma.externalDocument.create({
      data: {
        organizationId: org,
        patientId,
        authorUserId: ctx.user.id,
        encounterId: encounter?.id ?? null,
        unitId: encounter?.unitId ?? null,
        kind: input.kind,
        issuedOn: new Date(`${input.issuedOn}T00:00:00.000Z`),
        summary: input.summary,
        validationCode: input.validationCode ?? null,
      },
    });
    return (await this.dtos([created]))[0]!;
  }

  /**
   * Receita simples pelo adaptador de prescrição (hoje só o simulado), registrada como documento
   * externo da plataforma `memed`. O resumo começa com o aviso de receita simulada.
   */
  async createMemed(
    ctx: AuthContext,
    patientId: string,
    input: MemedPrescriptionInput,
  ): Promise<ExternalDocumentDto> {
    const org = ctx.user.organizationId;
    const professional = await this.prisma.professional.findFirst({
      where: { organizationId: org, userId: ctx.user.id, active: true },
      select: { crmNumber: true, crmState: true },
    });
    if (!professional) throw noProfessional();
    const encounter = await this.prisma.encounter.findFirst({
      where: { organizationId: org, doctorUserId: ctx.user.id, patientId, status: 'started' },
      select: { id: true, unitId: true },
    });
    const patient = await this.prisma.patient.findFirstOrThrow({
      where: { id: patientId, organizationId: org },
      select: { fullName: true, birthDate: true },
    });
    const unit = encounter?.unitId
      ? await this.prisma.unit.findUnique({
          where: { id: encounter.unitId },
          select: { timezone: true },
        })
      : null;
    const issued = await this.prescriptions.issue({
      prescriber: {
        name: ctx.user.name,
        crm: `CRM/${professional.crmState} ${professional.crmNumber}`,
      },
      patient: { fullName: patient.fullName, birthDate: dateOnly(patient.birthDate) },
      items: input.items,
    });
    const created = await this.prisma.externalDocument.create({
      data: {
        organizationId: org,
        patientId,
        authorUserId: ctx.user.id,
        encounterId: encounter?.id ?? null,
        unitId: encounter?.unitId ?? null,
        platform: 'memed' satisfies ExternalPlatform,
        kind: 'prescription',
        issuedOn: new Date(
          `${toLocal(this.clock.now(), unit?.timezone ?? DEFAULT_TIMEZONE).date}T00:00:00.000Z`,
        ),
        summary: memedPrescriptionSummary(input.items),
        validationCode: issued.validationCode,
      },
    });
    return (await this.dtos([created]))[0]!;
  }

  async cancel(
    ctx: AuthContext,
    doc: ExternalDocument,
    reason: string,
  ): Promise<ExternalDocumentDto> {
    const { count } = await this.prisma.externalDocument.updateMany({
      where: { id: doc.id, status: 'registered' },
      data: {
        status: 'cancelled',
        cancelledAt: this.clock.now(),
        cancelledByUserId: ctx.user.id,
        cancelReason: reason,
      },
    });
    if (count !== 1) {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE_TRANSITION,
        'Este registro já foi cancelado.',
      );
    }
    const fresh = await this.prisma.externalDocument.findUniqueOrThrow({ where: { id: doc.id } });
    return (await this.dtos([fresh]))[0]!;
  }

  async listCandidates(organizationId: string, patientId: string): Promise<ExternalDocument[]> {
    return this.prisma.externalDocument.findMany({
      where: { organizationId, patientId },
      orderBy: [{ issuedOn: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  async dtos(rows: ExternalDocument[]): Promise<ExternalDocumentDto[]> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.authorUserId))] } },
      select: { id: true, name: true },
    });
    const name = (id: string) => users.find((u) => u.id === id)?.name ?? '';
    return rows.map((d) => ({
      id: d.id,
      patientId: d.patientId,
      author: { id: d.authorUserId, name: name(d.authorUserId) },
      encounterId: d.encounterId,
      platform: d.platform as ExternalPlatform,
      kind: d.kind,
      status: d.status,
      issuedOn: dateOnly(d.issuedOn),
      summary: d.summary,
      validationCode: d.validationCode,
      createdAt: d.createdAt.toISOString(),
      cancelledAt: d.cancelledAt?.toISOString() ?? null,
      cancelReason: d.cancelReason,
    }));
  }
}
