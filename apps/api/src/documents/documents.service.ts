import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DOCUMENT_CONTENT_SCHEMAS,
  type DocumentContent,
  type DocumentDto,
  type DocumentEventDto,
  type DocumentSnapshot,
  type DocumentSummaryDto,
  ErrorCode,
  type documentCreateSchema,
} from '@crm/shared';
import type { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { parseBody } from '../common/validation.js';
import { PrismaService } from '../database/prisma.service.js';
import type { MedicalDocument, Prisma } from '../generated/prisma/client.js';
import type { AuthContext } from '../identity/session.service.js';
import { canonicalJson } from '../records/records.service.js';
import { toLocal } from '../scheduling/time.js';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

type Tx = Prisma.TransactionClient;

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** SHA-256 do conteúdo canônico do documento (docs/api/documentos.md, Assinatura). */
export function documentHash(d: MedicalDocument): string {
  const canonical = canonicalJson({
    id: d.id,
    kind: d.kind,
    patientId: d.patientId,
    authorUserId: d.authorUserId,
    issuedOn: d.issuedOn ? dateOnly(d.issuedOn) : null,
    snapshot: d.snapshot,
    content: d.content,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function invalidTransition(message: string): AppError {
  return new AppError(409, ErrorCode.INVALID_STATE_TRANSITION, message);
}

const noProfessional = () =>
  new AppError(
    422,
    ErrorCode.BUSINESS_RULE_VIOLATION,
    'Seu registro profissional (CRM) não está cadastrado ou está inativo. Peça ao administrador.',
  );

/**
 * Documentos médicos (docs/api/documentos.md). Este serviço só grava e lê; quem decide o acesso
 * é o controlador, pela política. O congelamento do assinado também está no banco
 * (gatilho `documents.protect_document`).
 */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async find(organizationId: string, id: string): Promise<MedicalDocument | null> {
    return this.prisma.medicalDocument.findFirst({ where: { id, organizationId } });
  }

  async patientExists(organizationId: string, patientId: string): Promise<boolean> {
    return (await this.prisma.patient.count({ where: { id: patientId, organizationId } })) > 0;
  }

  /** Nome para o PDF do rascunho, que ainda não tem o retrato da assinatura. */
  async patientName(doc: MedicalDocument): Promise<string> {
    const p = await this.prisma.patient.findUniqueOrThrow({
      where: { id: doc.patientId },
      select: { fullName: true },
    });
    return p.fullName;
  }

  private async professional(organizationId: string, userId: string) {
    return this.prisma.professional.findFirst({
      where: { organizationId, userId, active: true },
      select: {
        crmNumber: true,
        crmState: true,
        specialties: { select: { rqe: true, specialty: { select: { name: true } } } },
      },
    });
  }

  async create(
    ctx: AuthContext,
    patientId: string,
    input: z.infer<typeof documentCreateSchema>,
  ): Promise<DocumentDto> {
    const org = ctx.user.organizationId;
    if (!(await this.professional(org, ctx.user.id))) throw noProfessional();
    const encounter = await this.prisma.encounter.findFirst({
      where: { organizationId: org, doctorUserId: ctx.user.id, patientId, status: 'started' },
      select: { id: true, unitId: true },
    });
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.medicalDocument.create({
        data: {
          organizationId: org,
          patientId,
          authorUserId: ctx.user.id,
          encounterId: encounter?.id ?? null,
          unitId: encounter?.unitId ?? null,
          kind: input.kind,
          content: input.content as Prisma.InputJsonObject,
        },
        select: { id: true },
      });
      await this.event(tx, created.id, 'created', ctx.user.id);
      return created.id;
    });
    return this.dto(await this.reload(id));
  }

  /** Grava o rascunho, com controle de versão. O conteúdo é conferido pelo tipo gravado. */
  async save(
    ctx: AuthContext,
    doc: MedicalDocument,
    version: number,
    rawContent: unknown,
  ): Promise<DocumentDto> {
    if (doc.status !== 'draft') throw invalidTransition('Só um rascunho pode ser alterado.');
    const content = parseBody(DOCUMENT_CONTENT_SCHEMAS[doc.kind], rawContent);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.medicalDocument.updateMany({
        where: { id: doc.id, version, status: 'draft' },
        data: { version: version + 1, content: content as Prisma.InputJsonObject },
      });
      if (count !== 1) throw await this.conflict(tx, doc.id);
      await this.event(tx, doc.id, 'saved', ctx.user.id, { version: version + 1 });
    });
    return this.dto(await this.reload(doc.id));
  }

  private async conflict(tx: Tx, id: string): Promise<AppError> {
    const current = await tx.medicalDocument.findUniqueOrThrow({
      where: { id },
      select: { status: true, version: true },
    });
    if (current.status !== 'draft') return invalidTransition('O documento não é mais um rascunho.');
    return new AppError(
      409,
      ErrorCode.VERSION_CONFLICT,
      `O documento foi salvo em outro lugar (versão atual: ${current.version}). Seu texto não foi gravado; confira a versão atual antes de salvar de novo.`,
    );
  }

  async discard(ctx: AuthContext, doc: MedicalDocument): Promise<DocumentDto> {
    if (doc.status !== 'draft') throw invalidTransition('Só um rascunho pode ser descartado.');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.medicalDocument.updateMany({
        where: { id: doc.id, status: 'draft' },
        data: { status: 'discarded' },
      });
      if (count !== 1) throw await this.conflict(tx, doc.id);
      await this.event(tx, doc.id, 'discarded', ctx.user.id);
    });
    return this.dto(await this.reload(doc.id));
  }

  /** Retrato do emitente, do paciente e do local, congelado com o documento. */
  private async snapshot(doc: MedicalDocument): Promise<DocumentSnapshot> {
    const professional = await this.professional(doc.organizationId, doc.authorUserId);
    if (!professional) throw noProfessional();
    // Uma consulta por vez: o adaptador do pg avisa sobre consultas paralelas no mesmo cliente.
    const author = await this.prisma.user.findUniqueOrThrow({
      where: { id: doc.authorUserId },
      select: { name: true },
    });
    const patient = await this.prisma.patient.findUniqueOrThrow({
      where: { id: doc.patientId },
      select: { fullName: true, socialName: true, birthDate: true },
    });
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: doc.organizationId },
      select: { name: true },
    });
    const unit = doc.unitId
      ? await this.prisma.unit.findUnique({ where: { id: doc.unitId }, select: { name: true } })
      : null;
    return {
      issuer: {
        name: author.name,
        crm: `CRM/${professional.crmState} ${professional.crmNumber}`,
        specialties: professional.specialties
          .map((s) => ({ name: s.specialty.name, rqe: s.rqe }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      },
      patient: {
        fullName: patient.fullName,
        socialName: patient.socialName,
        birthDate: dateOnly(patient.birthDate),
      },
      place: { organization: organization.name, unit: unit?.name ?? null },
    };
  }

  private async issueDate(doc: MedicalDocument): Promise<Date> {
    const unit = doc.unitId
      ? await this.prisma.unit.findUnique({ where: { id: doc.unitId }, select: { timezone: true } })
      : null;
    const local = toLocal(this.clock.now(), unit?.timezone ?? DEFAULT_TIMEZONE);
    return new Date(`${local.date}T00:00:00.000Z`);
  }

  /** Assinatura eletrônica interna: retrato, data de emissão, resumo SHA-256 e evidências. */
  async sign(ctx: AuthContext, doc: MedicalDocument, version: number): Promise<DocumentDto> {
    if (doc.status !== 'draft') throw invalidTransition('Só um rascunho pode ser assinado.');
    if (doc.version !== version) {
      throw new AppError(
        409,
        ErrorCode.VERSION_CONFLICT,
        `O documento mudou desde que você o abriu (versão atual: ${doc.version}).`,
      );
    }
    // Rascunho gravado antes de uma regra nova continua precisando passar pelo esquema.
    parseBody(DOCUMENT_CONTENT_SCHEMAS[doc.kind], doc.content);
    const snapshot = await this.snapshot(doc);
    const issuedOn = await this.issueDate(doc);
    const signed = { ...doc, snapshot: snapshot as unknown as Prisma.JsonObject, issuedOn };
    const evidence = {
      method: 'internal_reauth',
      sessionId: ctx.session.id,
      reauthAt: ctx.session.reauthAt?.toISOString() ?? null,
      ip: ctx.request.ip?.slice(0, 64) ?? null,
      requestId: ctx.request.requestId.slice(0, 64),
    };
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.medicalDocument.updateMany({
        where: { id: doc.id, status: 'draft', version },
        data: {
          status: 'signed',
          snapshot: snapshot as unknown as Prisma.InputJsonObject,
          issuedOn,
          contentHash: documentHash(signed),
          signedAt: this.clock.now(),
          signatureEvidence: evidence,
        },
      });
      if (count !== 1) throw await this.conflict(tx, doc.id);
      await this.event(tx, doc.id, 'signed', ctx.user.id);
    });
    return this.dto(await this.reload(doc.id));
  }

  async cancel(ctx: AuthContext, doc: MedicalDocument, reason: string): Promise<DocumentDto> {
    if (doc.status !== 'signed')
      throw invalidTransition('Só um documento assinado pode ser cancelado.');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.medicalDocument.updateMany({
        where: { id: doc.id, status: 'signed' },
        data: {
          status: 'cancelled',
          cancelledAt: this.clock.now(),
          cancelledByUserId: ctx.user.id,
          cancelReason: reason,
        },
      });
      if (count !== 1) throw invalidTransition('O documento não está mais assinado.');
      await this.event(tx, doc.id, 'cancelled', ctx.user.id, { reason });
    });
    return this.dto(await this.reload(doc.id));
  }

  /** Documentos do paciente que podem aparecer na lista, antes do filtro da política. */
  async listCandidates(
    organizationId: string,
    patientId: string,
    userId: string,
  ): Promise<MedicalDocument[]> {
    return this.prisma.medicalDocument.findMany({
      where: {
        organizationId,
        patientId,
        OR: [
          { authorUserId: userId, status: { not: 'discarded' } },
          { status: { in: ['signed', 'cancelled'] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async history(doc: MedicalDocument): Promise<DocumentEventDto[]> {
    const rows = await this.prisma.documentEvent.findMany({
      where: { documentId: doc.id },
      orderBy: { seq: 'asc' },
    });
    const name = await this.names(rows.map((r) => r.byUserId));
    return rows.map((r) => ({
      type: r.type,
      at: r.at.toISOString(),
      by: name(r.byUserId),
      details: r.details ?? null,
    }));
  }

  private async event(
    tx: Tx,
    documentId: string,
    type: string,
    byUserId: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await tx.documentEvent.create({
      data: {
        documentId,
        type,
        at: this.clock.now(),
        byUserId,
        ...(details ? { details: details as Prisma.InputJsonObject } : {}),
      },
      select: { id: true },
    });
  }

  private async reload(id: string): Promise<MedicalDocument> {
    return this.prisma.medicalDocument.findUniqueOrThrow({ where: { id } });
  }

  private async names(ids: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return (id: string) => ({ id, name: users.find((u) => u.id === id)?.name ?? '' });
  }

  async dto(d: MedicalDocument): Promise<DocumentDto> {
    const name = await this.names([d.authorUserId]);
    return {
      id: d.id,
      patientId: d.patientId,
      author: name(d.authorUserId),
      encounterId: d.encounterId,
      kind: d.kind,
      status: d.status,
      version: d.version,
      content: d.content as DocumentContent,
      snapshot: (d.snapshot as DocumentSnapshot | null) ?? null,
      issuedOn: d.issuedOn ? dateOnly(d.issuedOn) : null,
      contentHash: d.contentHash,
      signedAt: d.signedAt?.toISOString() ?? null,
      integrity: d.contentHash ? (documentHash(d) === d.contentHash ? 'valid' : 'invalid') : null,
      cancelledAt: d.cancelledAt?.toISOString() ?? null,
      cancelReason: d.cancelReason,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  }

  async summaries(rows: MedicalDocument[]): Promise<DocumentSummaryDto[]> {
    const name = await this.names(rows.map((r) => r.authorUserId));
    return rows.map((d) => ({
      id: d.id,
      author: name(d.authorUserId),
      kind: d.kind,
      status: d.status,
      issuedOn: d.issuedOn ? dateOnly(d.issuedOn) : null,
      createdAt: d.createdAt.toISOString(),
    }));
  }
}
