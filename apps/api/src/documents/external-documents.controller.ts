import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type { AccessContext, Action } from '@crm/policy';
import {
  type ExternalDocumentDto,
  externalDocumentCancelSchema,
  externalDocumentCreateSchema,
  memedPrescriptionSchema,
} from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { CareService } from '../care/care.service.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { DocumentsService } from './documents.service.js';
import { ExternalDocumentsService } from './external-documents.service.js';

const uuid = new ParseUUIDPipe();
const TYPE = 'medical_document';

/**
 * Documentos emitidos na plataforma do CFM e registrados aqui (docs/api/documentos-externos.md).
 * Mesma regra de acesso dos documentos médicos: recurso `medical_document` (ADR 0034).
 */
@Controller()
export class ExternalDocumentsController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(CareService) private readonly care: CareService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(ExternalDocumentsService) private readonly external: ExternalDocumentsService,
  ) {}

  @Post('patients/:id/external-documents')
  async create(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) patientId: string,
    @Body() body: unknown,
  ): Promise<ExternalDocumentDto> {
    await this.requirePatient(ctx, 'create', patientId);
    await this.authz.authorize(
      ctx,
      'create',
      { type: TYPE, patientId },
      await this.context(ctx, patientId),
    );
    return this.external.create(ctx, patientId, parseBody(externalDocumentCreateSchema, body));
  }

  @Post('patients/:id/external-documents/memed')
  async createMemed(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) patientId: string,
    @Body() body: unknown,
  ): Promise<ExternalDocumentDto> {
    await this.requirePatient(ctx, 'create', patientId);
    await this.authz.authorize(
      ctx,
      'create',
      { type: TYPE, patientId },
      await this.context(ctx, patientId),
    );
    return this.external.createMemed(ctx, patientId, parseBody(memedPrescriptionSchema, body));
  }

  @Get('patients/:id/external-documents')
  async list(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) patientId: string,
  ): Promise<ExternalDocumentDto[]> {
    await this.requirePatient(ctx, 'view', patientId);
    const context = await this.context(ctx, patientId);
    // Uma entrada de auditoria pela consulta; os próprios registros o médico sempre vê.
    await this.authz.authorize(
      ctx,
      'view',
      { type: TYPE, patientId, authorUserId: ctx.user.id },
      context,
    );
    const rows = await this.external.listCandidates(ctx.user.organizationId, patientId);
    const visible = rows.filter(
      (d) =>
        this.authz.check(
          ctx,
          'view',
          { type: TYPE, id: d.id, patientId, authorUserId: d.authorUserId },
          context,
        ).allowed,
    );
    return this.external.dtos(visible);
  }

  @Post('external-documents/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<ExternalDocumentDto> {
    const doc = await this.external.find(ctx.user.organizationId, id);
    if (!doc) {
      return this.authz.notFound(ctx, 'correct', TYPE, id, 'Registro não encontrado.');
    }
    await this.authz.authorize(
      ctx,
      'correct',
      {
        type: TYPE,
        id: doc.id,
        unitId: doc.unitId ?? undefined,
        patientId: doc.patientId,
        authorUserId: doc.authorUserId,
      },
      await this.context(ctx, doc.patientId),
    );
    return this.external.cancel(ctx, doc, parseBody(externalDocumentCancelSchema, body).reason);
  }

  /** Vínculo do médico com o paciente; para outros papéis, contexto vazio (a política nega). */
  private async context(ctx: AuthContext, patientId: string): Promise<AccessContext> {
    return ctx.user.roles.includes('doctor')
      ? this.care.accessContext(ctx.user.organizationId, ctx.user.id, patientId)
      : {};
  }

  private async requirePatient(ctx: AuthContext, action: Action, patientId: string) {
    if (!(await this.documents.patientExists(ctx.user.organizationId, patientId))) {
      await this.authz.notFound(ctx, action, TYPE, patientId, 'Paciente não encontrado.');
    }
  }
}
