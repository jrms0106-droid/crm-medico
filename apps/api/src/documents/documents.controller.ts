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
  StreamableFile,
} from '@nestjs/common';
import type { AccessContext, Action } from '@crm/policy';
import {
  type DocumentDto,
  type DocumentEventDto,
  type DocumentSummaryDto,
  ErrorCode,
  documentCancelSchema,
  documentCreateSchema,
  documentUpdateSchema,
  documentVersionSchema,
} from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { parseBody } from '../common/validation.js';
import { CareService } from '../care/care.service.js';
import type { MedicalDocument } from '../generated/prisma/client.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { renderDocumentPdf } from './documents.pdf.js';
import { DocumentsService } from './documents.service.js';

const uuid = new ParseUUIDPipe();

/** Documentos médicos (docs/api/documentos.md). Acesso sempre pela política, recurso `medical_document`. */
@Controller()
export class DocumentsController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(CareService) private readonly care: CareService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
  ) {}

  @Post('patients/:id/documents')
  async create(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) patientId: string,
    @Body() body: unknown,
  ): Promise<DocumentDto> {
    await this.requirePatient(ctx, 'create', patientId);
    await this.authz.authorize(
      ctx,
      'create',
      { type: 'medical_document', patientId },
      await this.context(ctx, patientId),
    );
    return this.documents.create(ctx, patientId, parseBody(documentCreateSchema, body));
  }

  @Get('patients/:id/documents')
  async list(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) patientId: string,
  ): Promise<DocumentSummaryDto[]> {
    await this.requirePatient(ctx, 'view', patientId);
    const context = await this.context(ctx, patientId);
    // Uma entrada de auditoria pela consulta; os próprios documentos o médico sempre vê.
    await this.authz.authorize(
      ctx,
      'view',
      { type: 'medical_document', patientId, authorUserId: ctx.user.id },
      context,
    );
    const rows = await this.documents.listCandidates(
      ctx.user.organizationId,
      patientId,
      ctx.user.id,
    );
    const visible = rows.filter(
      (d) =>
        this.authz.check(
          ctx,
          'view',
          { type: 'medical_document', id: d.id, patientId, authorUserId: d.authorUserId },
          context,
        ).allowed,
    );
    return this.documents.summaries(visible);
  }

  @Get('documents/:id')
  async get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<DocumentDto> {
    return this.documents.dto(await this.load(ctx, id, 'view'));
  }

  @Get('documents/:id/history')
  async history(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
  ): Promise<DocumentEventDto[]> {
    return this.documents.history(await this.load(ctx, id, 'view'));
  }

  @Patch('documents/:id')
  async save(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<DocumentDto> {
    const doc = await this.load(ctx, id, 'edit');
    const input = parseBody(documentUpdateSchema, body);
    return this.documents.save(ctx, doc, input.version, input.content);
  }

  @Post('documents/:id/sign')
  @HttpCode(200)
  async sign(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<DocumentDto> {
    const doc = await this.load(ctx, id, 'sign');
    this.authz.requireRecentReauth(ctx);
    return this.documents.sign(ctx, doc, parseBody(documentVersionSchema, body).version);
  }

  @Post('documents/:id/discard')
  @HttpCode(200)
  async discard(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<DocumentDto> {
    return this.documents.discard(ctx, await this.load(ctx, id, 'edit'));
  }

  @Post('documents/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<DocumentDto> {
    const doc = await this.load(ctx, id, 'correct');
    return this.documents.cancel(ctx, doc, parseBody(documentCancelSchema, body).reason);
  }

  @Get('documents/:id/pdf')
  async pdf(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<StreamableFile> {
    const doc = await this.load(ctx, id, 'export');
    if (doc.status === 'discarded') {
      throw new AppError(
        409,
        ErrorCode.INVALID_STATE_TRANSITION,
        'Documento descartado não gera PDF.',
      );
    }
    const dto = await this.documents.dto(doc);
    const buffer = await renderDocumentPdf(dto, await this.documents.patientName(doc));
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="documento-${doc.id}.pdf"`,
      length: buffer.length,
    });
  }

  /** Vínculo do médico com o paciente; para outros papéis, contexto vazio (a política nega). */
  private async context(ctx: AuthContext, patientId: string): Promise<AccessContext> {
    return ctx.user.roles.includes('doctor')
      ? this.care.accessContext(ctx.user.organizationId, ctx.user.id, patientId)
      : {};
  }

  private async requirePatient(ctx: AuthContext, action: Action, patientId: string) {
    if (!(await this.documents.patientExists(ctx.user.organizationId, patientId))) {
      await this.authz.notFound(
        ctx,
        action,
        'medical_document',
        patientId,
        'Paciente não encontrado.',
      );
    }
  }

  /**
   * Carrega o documento e confere a permissão. Rascunhos e descartados de outros autores não
   * existem para quem não é o autor (404, auditado).
   */
  private async load(ctx: AuthContext, id: string, action: Action): Promise<MedicalDocument> {
    const doc = await this.documents.find(ctx.user.organizationId, id);
    const hiddenDraft =
      doc &&
      doc.authorUserId !== ctx.user.id &&
      (doc.status === 'draft' || doc.status === 'discarded');
    if (!doc || hiddenDraft) {
      return this.authz.notFound(ctx, action, 'medical_document', id, 'Documento não encontrado.');
    }
    // O acesso emergencial não libera documentos: a política não concede (docs/api/documentos.md).
    const context = await this.context(ctx, doc.patientId);
    await this.authz.authorize(
      ctx,
      action,
      {
        type: 'medical_document',
        id: doc.id,
        unitId: doc.unitId ?? undefined,
        patientId: doc.patientId,
        authorUserId: doc.authorUserId,
      },
      context,
    );
    return doc;
  }
}
