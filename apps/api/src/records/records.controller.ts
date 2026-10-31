import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import type { AccessContext, Action } from '@crm/policy';
import {
  ErrorCode,
  type RecordDto,
  type RecordSummaryDto,
  type RecordVersionDto,
  recordCorrectionSchema,
  recordCreateSchema,
  recordReopenSchema,
  recordUpdateSchema,
  recordVersionSchema,
  recordViewQuerySchema,
  timelineQuerySchema,
} from '@crm/shared';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../authz/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { parseBody } from '../common/validation.js';
import { CareService } from '../care/care.service.js';
import type { ClinicalRecord } from '../generated/prisma/client.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { ClinicalCopyService } from './clinical-copy.service.js';
import { type RecordEventDto, RecordsService } from './records.service.js';

const uuid = new ParseUUIDPipe();

const isSensitive = (r: ClinicalRecord) => r.sensitivity !== 'normal';

/**
 * O trabalho sobre o rascunho de uma retificação ou de um adendo conta como `correct`, para o
 * autor conseguir terminá-lo mesmo com o vínculo expirado (docs/api/prontuario.md).
 */
function actionFor(record: ClinicalRecord, base: Action): Action {
  return record.rectifiesId || record.addendumOfId ? 'correct' : base;
}

@Controller()
export class RecordsController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CareService) private readonly care: CareService,
    @Inject(RecordsService) private readonly records: RecordsService,
    @Inject(ClinicalCopyService) private readonly copies: ClinicalCopyService,
  ) {}

  @Post('patients/:id/records')
  async create(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) patientId: string,
    @Body() body: unknown,
  ): Promise<RecordDto> {
    await this.requirePatient(ctx, 'create', patientId);
    await this.authz.authorize(
      ctx,
      'create',
      { type: 'clinical_record', patientId },
      await this.context(ctx, patientId),
    );
    return this.records.create(ctx, patientId, parseBody(recordCreateSchema, body));
  }

  @Get('patients/:id/records')
  async timeline(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) patientId: string,
    @Query() query: unknown,
  ): Promise<RecordSummaryDto[]> {
    await this.requirePatient(ctx, 'view', patientId);
    const context = await this.context(ctx, patientId);
    // Uma entrada de auditoria pela consulta; os próprios registros o médico sempre vê.
    await this.authz.authorize(
      ctx,
      'view',
      { type: 'clinical_record', patientId, authorUserId: ctx.user.id },
      context,
    );
    const { includeArchived } = parseBody(timelineQuerySchema, query);
    const rows = await this.records.timelineCandidates(
      ctx.user.organizationId,
      patientId,
      ctx.user.id,
      includeArchived,
    );
    const visible = rows.flatMap((record) => {
      const ref = {
        type: 'clinical_record' as const,
        id: record.id,
        patientId,
        authorUserId: record.authorUserId,
        sensitivity: record.sensitivity,
      };
      if (this.authz.check(ctx, 'view', ref, context).allowed) {
        return [{ record, contentHidden: false }];
      }
      if (this.authz.check(ctx, 'view', ref, { ...context, justified: true }).allowed) {
        return [{ record, contentHidden: true }];
      }
      return [];
    });
    return this.records.summaries(visible);
  }

  /**
   * Cópia do prontuário pedida pelo paciente (docs/api/direitos-do-titular.md): só o médico com
   * vínculo valendo, com reautenticação recente. Arquivo JSON para entregar ao paciente.
   */
  @Get('patients/:id/clinical-copy')
  async clinicalCopy(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) patientId: string,
  ): Promise<StreamableFile> {
    await this.requirePatient(ctx, 'export', patientId);
    const context = await this.context(ctx, patientId);
    await this.authz.authorize(
      ctx,
      'export',
      { type: 'clinical_record', patientId },
      { ...context, emergencyAccess: false },
    );
    this.authz.requireRecentReauth(ctx);
    const data = await this.copies.build(ctx, patientId, context);
    const day = data.generatedAt.slice(0, 10);
    return new StreamableFile(Buffer.from(JSON.stringify(data, null, 2), 'utf8'), {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="copia-do-prontuario-${day}.json"`,
    });
  }

  @Get('records/:id')
  async get(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Query() query: unknown,
  ): Promise<RecordDto> {
    const { justification } = parseBody(recordViewQuerySchema, query);
    const record = await this.load(ctx, id, 'view', justification !== undefined);
    if (justification && isSensitive(record) && record.authorUserId !== ctx.user.id) {
      await this.records.recordJustification(record, ctx.user.id, justification);
      await this.audit.record(ctx, {
        action: 'view',
        resourceType: 'clinical_record',
        resourceId: record.id,
        patientId: record.patientId,
        outcome: 'allowed',
        reason: 'sensitive_access_justified',
      });
    }
    return this.records.dto(record);
  }

  @Get('records/:id/versions')
  async versions(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
  ): Promise<RecordVersionDto[]> {
    const record = await this.load(ctx, id, 'view');
    await this.requireAuthor(ctx, record, 'view');
    return this.records.versions(record);
  }

  @Get('records/:id/history')
  async history(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
  ): Promise<RecordEventDto[]> {
    return this.records.history(await this.load(ctx, id, 'view'));
  }

  @Patch('records/:id')
  async save(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<RecordDto> {
    const record = await this.load(ctx, id, 'edit');
    return this.records.save(ctx, record, parseBody(recordUpdateSchema, body));
  }

  @Post('records/:id/finalize')
  @HttpCode(200)
  async finalize(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<RecordDto> {
    const record = await this.load(ctx, id, 'edit');
    return this.records.finalize(ctx, record, parseBody(recordVersionSchema, body).version);
  }

  @Post('records/:id/reopen')
  @HttpCode(200)
  async reopen(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<RecordDto> {
    const record = await this.load(ctx, id, 'edit');
    return this.records.reopen(ctx, record, parseBody(recordReopenSchema, body).reason);
  }

  @Post('records/:id/discard')
  @HttpCode(200)
  async discard(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<RecordDto> {
    return this.records.discard(ctx, await this.load(ctx, id, 'edit'));
  }

  @Post('records/:id/sign')
  @HttpCode(200)
  async sign(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<RecordDto> {
    const record = await this.load(ctx, id, 'sign');
    this.authz.requireRecentReauth(ctx);
    return this.records.sign(ctx, record, parseBody(recordVersionSchema, body).version);
  }

  @Post('records/:id/rectify')
  async rectify(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<RecordDto> {
    const original = await this.load(ctx, id, 'correct');
    return this.records.createCorrection(
      ctx,
      original,
      'rectify',
      parseBody(recordCorrectionSchema, body),
    );
  }

  @Post('records/:id/addendum')
  async addendum(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<RecordDto> {
    const original = await this.load(ctx, id, 'correct');
    return this.records.createCorrection(
      ctx,
      original,
      'addendum',
      parseBody(recordCorrectionSchema, body),
    );
  }

  @Post('records/:id/archive')
  @HttpCode(200)
  async archive(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<RecordDto> {
    return this.records.archive(ctx, await this.load(ctx, id, 'edit'));
  }

  /** Vínculo do médico com o paciente; para outros papéis, contexto vazio (a política nega). */
  private async context(ctx: AuthContext, patientId: string): Promise<AccessContext> {
    return ctx.user.roles.includes('doctor')
      ? this.care.accessContext(ctx.user.organizationId, ctx.user.id, patientId)
      : {};
  }

  private async requirePatient(ctx: AuthContext, action: Action, patientId: string) {
    if (!(await this.records.patientExists(ctx.user.organizationId, patientId))) {
      await this.authz.notFound(
        ctx,
        action,
        'clinical_record',
        patientId,
        'Paciente não encontrado.',
      );
    }
  }

  /**
   * Carrega o registro e confere a permissão. Rascunhos e descartados de outros autores não
   * existem para quem não é o autor (404, auditado).
   */
  private async load(
    ctx: AuthContext,
    id: string,
    base: Action,
    justified = false,
  ): Promise<ClinicalRecord> {
    const record = await this.records.find(ctx.user.organizationId, id);
    const hiddenDraft =
      record &&
      record.authorUserId !== ctx.user.id &&
      (record.status === 'draft' || record.status === 'discarded');
    if (!record || hiddenDraft) {
      return this.authz.notFound(ctx, base, 'clinical_record', id, 'Registro não encontrado.');
    }
    const context = await this.context(ctx, record.patientId);
    await this.authz.authorize(
      ctx,
      actionFor(record, base),
      {
        type: 'clinical_record',
        id: record.id,
        unitId: record.unitId ?? undefined,
        patientId: record.patientId,
        authorUserId: record.authorUserId,
        sensitivity: record.sensitivity,
      },
      { ...context, justified },
    );
    return record;
  }

  /** As versões salvas do rascunho são só do autor, mesmo quando a leitura é permitida. */
  private async requireAuthor(ctx: AuthContext, record: ClinicalRecord, action: Action) {
    if (record.authorUserId === ctx.user.id) return;
    await this.audit.record(ctx, {
      action,
      resourceType: 'clinical_record',
      resourceId: record.id,
      patientId: record.patientId,
      outcome: 'denied',
      reason: 'not_author',
    });
    throw new AppError(403, ErrorCode.FORBIDDEN, 'Só o autor do registro pode fazer isso.');
  }
}
