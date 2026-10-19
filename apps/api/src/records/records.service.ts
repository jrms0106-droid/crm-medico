import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  GENERIC_FORM_VERSION,
  type RecordContent,
  type RecordDto,
  type RecordStatus,
  type RecordSummaryDto,
  type RecordVersionDto,
  hasContent,
  type recordCorrectionSchema,
  type recordCreateSchema,
  type recordUpdateSchema,
} from '@crm/shared';
import type { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { ClinicalRecord, Prisma } from '../generated/prisma/client.js';
import type { AuthContext } from '../identity/session.service.js';
import { toLocal } from '../scheduling/time.js';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

type Tx = Prisma.TransactionClient;

export interface RecordEventDto {
  type: string;
  at: string;
  by: { id: string; name: string };
  details: unknown;
}

/** JSON com as chaves em ordem, para o resumo da assinatura não depender da ordem de gravação. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** SHA-256 do conteúdo canônico do registro (docs/api/prontuario.md, Assinatura). */
export function recordHash(r: ClinicalRecord): string {
  const canonical = canonicalJson({
    id: r.id,
    patientId: r.patientId,
    authorUserId: r.authorUserId,
    kind: r.kind,
    clinicalDate: dateOnly(r.clinicalDate),
    sensitivity: r.sensitivity,
    formVersion: r.formVersion,
    rectifiesId: r.rectifiesId,
    addendumOfId: r.addendumOfId,
    content: r.content,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function invalidTransition(message: string): AppError {
  return new AppError(409, ErrorCode.INVALID_STATE_TRANSITION, message);
}

function isUniqueViolation(error: unknown, name: string): boolean {
  const text = (() => {
    try {
      return JSON.stringify(error, Object.getOwnPropertyNames(error ?? {}));
    } catch {
      return String(error);
    }
  })();
  return text.includes(name) || (text.includes('23505') && text.includes('rectifies_id'));
}

/**
 * Registros do prontuário (docs/api/prontuario.md). Este serviço só grava e lê; quem decide o
 * acesso é o controlador, pela política. O congelamento do registro assinado também está no
 * banco (gatilho `records.protect_record`).
 */
@Injectable()
export class RecordsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async find(organizationId: string, id: string): Promise<ClinicalRecord | null> {
    return this.prisma.clinicalRecord.findFirst({ where: { id, organizationId } });
  }

  async patientExists(organizationId: string, patientId: string): Promise<boolean> {
    return (await this.prisma.patient.count({ where: { id: patientId, organizationId } })) > 0;
  }

  /** Atendimento aberto do médico com o paciente, ao qual o registro novo fica ligado. */
  private async openEncounter(organizationId: string, doctorUserId: string, patientId: string) {
    const encounter = await this.prisma.encounter.findFirst({
      where: { organizationId, doctorUserId, patientId, status: 'started' },
      select: { id: true, unitId: true },
    });
    if (!encounter) return null;
    const unit = await this.prisma.unit.findUnique({
      where: { id: encounter.unitId },
      select: { timezone: true },
    });
    return { ...encounter, timezone: unit?.timezone };
  }

  private async today(unitTimezone: string | undefined): Promise<Date> {
    const local = toLocal(this.clock.now(), unitTimezone ?? DEFAULT_TIMEZONE);
    return new Date(`${local.date}T00:00:00.000Z`);
  }

  async create(
    ctx: AuthContext,
    patientId: string,
    input: z.infer<typeof recordCreateSchema>,
  ): Promise<RecordDto> {
    const org = ctx.user.organizationId;
    const encounter = await this.openEncounter(org, ctx.user.id, patientId);
    const clinicalDate = input.clinicalDate
      ? new Date(`${input.clinicalDate}T00:00:00.000Z`)
      : await this.today(encounter?.timezone);
    const id = await this.insertDraft(ctx, {
      organizationId: org,
      patientId,
      authorUserId: ctx.user.id,
      encounterId: encounter?.id ?? null,
      unitId: encounter?.unitId ?? null,
      kind: input.kind,
      clinicalDate,
      sensitivity: input.sensitivity,
      formVersion: GENERIC_FORM_VERSION,
      content: input.content,
    });
    return this.dto(await this.reload(id));
  }

  /** Rascunho de retificação ou de adendo sobre um registro assinado. */
  async createCorrection(
    ctx: AuthContext,
    original: ClinicalRecord,
    mode: 'rectify' | 'addendum',
    input: z.infer<typeof recordCorrectionSchema>,
  ): Promise<RecordDto> {
    if (mode === 'rectify' && original.status !== 'signed') {
      throw invalidTransition(
        'Só um registro assinado (e ainda não retificado) pode ser retificado.',
      );
    }
    if (mode === 'addendum' && !['signed', 'rectified'].includes(original.status)) {
      throw invalidTransition('Só um registro assinado pode receber adendo.');
    }
    const encounter = await this.openEncounter(
      original.organizationId,
      ctx.user.id,
      original.patientId,
    );
    try {
      const id = await this.insertDraft(ctx, {
        organizationId: original.organizationId,
        patientId: original.patientId,
        authorUserId: ctx.user.id,
        encounterId: encounter?.id ?? null,
        unitId: encounter?.unitId ?? original.unitId,
        kind: mode === 'addendum' ? 'addendum' : original.kind,
        clinicalDate:
          mode === 'addendum' ? await this.today(encounter?.timezone) : original.clinicalDate,
        sensitivity: original.sensitivity,
        formVersion: original.formVersion,
        content: input.content ?? (mode === 'rectify' ? (original.content as RecordContent) : {}),
        rectifiesId: mode === 'rectify' ? original.id : null,
        addendumOfId: mode === 'addendum' ? original.id : null,
        justification: input.justification,
      });
      return this.dto(await this.reload(id));
    } catch (error) {
      if (isUniqueViolation(error, 'clinical_records_one_open_rectification')) {
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          'Este registro já tem uma retificação em andamento ou assinada.',
        );
      }
      throw error;
    }
  }

  private async insertDraft(
    ctx: AuthContext,
    data: Omit<Prisma.ClinicalRecordUncheckedCreateInput, 'content'> & { content: RecordContent },
  ): Promise<string> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.clinicalRecord.create({
        data: { ...data, content: data.content as Prisma.InputJsonObject },
        select: { id: true },
      });
      await tx.recordVersion.create({
        data: {
          recordId: created.id,
          version: 1,
          content: data.content as Prisma.InputJsonObject,
          savedAt: now,
          savedByUserId: ctx.user.id,
        },
        select: { id: true },
      });
      await this.event(tx, created.id, 'created', ctx.user.id, {
        rectifiesId: data.rectifiesId ?? undefined,
        addendumOfId: data.addendumOfId ?? undefined,
        justification: data.justification ?? undefined,
      });
      return created.id;
    });
  }

  /** Salvamento do rascunho, com controle de versão: quem salvou por último não apaga o outro. */
  async save(
    ctx: AuthContext,
    record: ClinicalRecord,
    input: z.infer<typeof recordUpdateSchema>,
  ): Promise<RecordDto> {
    if (record.status !== 'draft') {
      throw invalidTransition('Só um rascunho pode ser alterado. Reabra o registro finalizado.');
    }
    const content = (input.content ?? record.content) as Prisma.InputJsonObject;
    const next = input.version + 1;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.clinicalRecord.updateMany({
        where: { id: record.id, version: input.version, status: 'draft' },
        data: {
          version: next,
          content,
          ...(input.clinicalDate
            ? { clinicalDate: new Date(`${input.clinicalDate}T00:00:00.000Z`) }
            : {}),
          ...(input.sensitivity ? { sensitivity: input.sensitivity } : {}),
        },
      });
      if (count !== 1) throw await this.conflict(tx, record.id);
      await tx.recordVersion.create({
        data: {
          recordId: record.id,
          version: next,
          content,
          savedAt: this.clock.now(),
          savedByUserId: ctx.user.id,
        },
        select: { id: true },
      });
    });
    return this.dto(await this.reload(record.id));
  }

  /** Explica por que a gravação condicional não pegou: outra versão ou outro estado. */
  private async conflict(tx: Tx, id: string): Promise<AppError> {
    const current = await tx.clinicalRecord.findUniqueOrThrow({
      where: { id },
      select: { status: true, version: true },
    });
    if (current.status !== 'draft') {
      return invalidTransition('O registro não é mais um rascunho.');
    }
    return new AppError(
      409,
      ErrorCode.VERSION_CONFLICT,
      `O registro foi salvo em outro lugar (versão atual: ${current.version}). Seu texto não foi gravado; compare com a versão atual antes de salvar de novo.`,
    );
  }

  async finalize(ctx: AuthContext, record: ClinicalRecord, version: number): Promise<RecordDto> {
    if (record.status !== 'draft') throw invalidTransition('Só um rascunho pode ser finalizado.');
    if (!hasContent(record.content as RecordContent)) {
      throw new AppError(
        422,
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Preencha ao menos um campo antes de finalizar.',
      );
    }
    await this.transition(ctx, record, { version, status: 'draft' }, 'finalized', 'finalized', {
      everFinalized: true,
    });
    return this.dto(await this.reload(record.id));
  }

  async reopen(ctx: AuthContext, record: ClinicalRecord, reason: string): Promise<RecordDto> {
    if (record.status !== 'finalized') {
      throw invalidTransition('Só um registro finalizado e não assinado pode ser reaberto.');
    }
    await this.transition(
      ctx,
      record,
      { status: 'finalized' },
      'draft',
      'reopened',
      {},
      { reason },
    );
    return this.dto(await this.reload(record.id));
  }

  async discard(ctx: AuthContext, record: ClinicalRecord): Promise<RecordDto> {
    if (record.status !== 'draft' || record.everFinalized) {
      throw invalidTransition('Só um rascunho que nunca foi finalizado pode ser descartado.');
    }
    await this.transition(
      ctx,
      record,
      { status: 'draft', everFinalized: false },
      'discarded',
      'discarded',
    );
    return this.dto(await this.reload(record.id));
  }

  async archive(ctx: AuthContext, record: ClinicalRecord): Promise<RecordDto> {
    if (record.status !== 'signed' && record.status !== 'rectified') {
      throw invalidTransition('Só um registro assinado ou retificado pode ser arquivado.');
    }
    await this.transition(ctx, record, { status: record.status }, 'archived', 'archived', {
      archivedAt: this.clock.now(),
    });
    return this.dto(await this.reload(record.id));
  }

  /** Mudança de estado condicional (o estado esperado vai no WHERE) com evento no histórico. */
  private async transition(
    ctx: AuthContext,
    record: ClinicalRecord,
    expected: Prisma.ClinicalRecordWhereInput,
    status: RecordStatus,
    eventType: string,
    extra: Prisma.ClinicalRecordUpdateManyMutationInput = {},
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.clinicalRecord.updateMany({
        where: { id: record.id, ...expected },
        data: { status, ...extra },
      });
      if (count !== 1) throw await this.conflict(tx, record.id);
      await this.event(tx, record.id, eventType, ctx.user.id, details);
    });
  }

  /**
   * Assinatura eletrônica interna: grava o resumo SHA-256 e as evidências. Se o registro é uma
   * retificação, o original passa a `rectified` na mesma transação.
   */
  async sign(ctx: AuthContext, record: ClinicalRecord, version: number): Promise<RecordDto> {
    if (record.status !== 'finalized') {
      throw invalidTransition('Só um registro finalizado pode ser assinado.');
    }
    if (record.version !== version) {
      throw new AppError(
        409,
        ErrorCode.VERSION_CONFLICT,
        `O registro mudou desde que você o abriu (versão atual: ${record.version}).`,
      );
    }
    const now = this.clock.now();
    const evidence = {
      method: 'internal_reauth',
      sessionId: ctx.session.id,
      reauthAt: ctx.session.reauthAt?.toISOString() ?? null,
      ip: ctx.request.ip?.slice(0, 64) ?? null,
      requestId: ctx.request.requestId.slice(0, 64),
    };
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.clinicalRecord.updateMany({
        where: { id: record.id, status: 'finalized', version },
        data: {
          status: 'signed',
          contentHash: recordHash(record),
          signedAt: now,
          signatureEvidence: evidence,
        },
      });
      if (count !== 1) throw await this.conflict(tx, record.id);
      await this.event(tx, record.id, 'signed', ctx.user.id);
      if (record.rectifiesId) {
        const replaced = await tx.clinicalRecord.updateMany({
          where: { id: record.rectifiesId, status: 'signed' },
          data: { status: 'rectified', rectifiedById: record.id },
        });
        if (replaced.count !== 1) {
          throw invalidTransition(
            'O registro original não está mais assinado e não pode ser retificado.',
          );
        }
        await this.event(tx, record.rectifiesId, 'rectified', ctx.user.id, {
          rectifiedById: record.id,
        });
      }
      if (record.addendumOfId) {
        await this.event(tx, record.addendumOfId, 'addendum_signed', ctx.user.id, {
          addendumId: record.id,
        });
      }
    });
    return this.dto(await this.reload(record.id));
  }

  async recordJustification(record: ClinicalRecord, userId: string, justification: string) {
    await this.prisma.accessJustification.create({
      data: { recordId: record.id, userId, justification, at: this.clock.now() },
      select: { id: true },
    });
  }

  /** Registros do paciente que podem aparecer na linha do tempo, antes do filtro da política. */
  async timelineCandidates(
    organizationId: string,
    patientId: string,
    userId: string,
    includeArchived: boolean,
  ): Promise<ClinicalRecord[]> {
    const hidden: RecordStatus[] = includeArchived ? [] : ['archived'];
    return this.prisma.clinicalRecord.findMany({
      where: {
        organizationId,
        patientId,
        status: { notIn: hidden },
        OR: [{ authorUserId: userId }, { status: { notIn: ['draft', 'discarded'] } }],
      },
      orderBy: [{ clinicalDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  async versions(record: ClinicalRecord): Promise<RecordVersionDto[]> {
    const rows = await this.prisma.recordVersion.findMany({
      where: { recordId: record.id },
      orderBy: { version: 'desc' },
    });
    const name = await this.names(rows.map((r) => r.savedByUserId));
    return rows.map((r) => ({
      version: r.version,
      savedAt: r.savedAt.toISOString(),
      savedBy: name(r.savedByUserId),
      content: r.content as RecordContent,
    }));
  }

  async history(record: ClinicalRecord): Promise<RecordEventDto[]> {
    const rows = await this.prisma.recordEvent.findMany({
      where: { recordId: record.id },
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
    recordId: string,
    type: string,
    byUserId: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const clean = details
      ? Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined))
      : undefined;
    await tx.recordEvent.create({
      data: {
        recordId,
        type,
        at: this.clock.now(),
        byUserId,
        ...(clean && Object.keys(clean).length > 0
          ? { details: clean as Prisma.InputJsonObject }
          : {}),
      },
      select: { id: true },
    });
  }

  private async reload(id: string): Promise<ClinicalRecord> {
    return this.prisma.clinicalRecord.findUniqueOrThrow({ where: { id } });
  }

  private async names(ids: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return (id: string) => ({ id, name: users.find((u) => u.id === id)?.name ?? '' });
  }

  async dto(r: ClinicalRecord): Promise<RecordDto> {
    const name = await this.names([r.authorUserId]);
    return {
      id: r.id,
      patientId: r.patientId,
      author: name(r.authorUserId),
      encounterId: r.encounterId,
      kind: r.kind,
      clinicalDate: dateOnly(r.clinicalDate),
      sensitivity: r.sensitivity,
      status: r.status,
      version: r.version,
      formVersion: r.formVersion,
      content: r.content as RecordContent,
      contentHash: r.contentHash,
      signedAt: r.signedAt?.toISOString() ?? null,
      integrity: r.contentHash ? (recordHash(r) === r.contentHash ? 'valid' : 'invalid') : null,
      rectifiesId: r.rectifiesId,
      rectifiedById: r.rectifiedById,
      addendumOfId: r.addendumOfId,
      justification: r.justification,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async summaries(
    rows: { record: ClinicalRecord; contentHidden: boolean }[],
  ): Promise<RecordSummaryDto[]> {
    const name = await this.names(rows.map((r) => r.record.authorUserId));
    return rows.map(({ record: r, contentHidden }) => ({
      id: r.id,
      author: name(r.authorUserId),
      kind: r.kind,
      clinicalDate: dateOnly(r.clinicalDate),
      sensitivity: r.sensitivity,
      status: r.status,
      rectifiesId: r.rectifiesId,
      rectifiedById: r.rectifiedById,
      addendumOfId: r.addendumOfId,
      contentHidden,
      content: contentHidden ? null : (r.content as RecordContent),
    }));
  }
}
