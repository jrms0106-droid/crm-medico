import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  type AccessReportDto,
  type SubjectRequestDto,
  accessReportQuerySchema,
  subjectRequestCreateSchema,
  subjectRequestListQuerySchema,
  subjectRequestResolveSchema,
} from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { PrivacyService } from './privacy.service.js';

const uuid = new ParseUUIDPipe();

/** Direitos do titular (docs/api/direitos-do-titular.md). Acesso sempre pela política. */
@Controller()
export class PrivacyController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(PrivacyService) private readonly privacy: PrivacyService,
  ) {}

  @Get('privacy/requests')
  async list(@Auth() ctx: AuthContext, @Query() query: unknown): Promise<SubjectRequestDto[]> {
    const q = parseBody(subjectRequestListQuerySchema, query);
    await this.authz.authorize(ctx, 'view', { type: 'patient_rights', patientId: q.patientId });
    return this.privacy.listRequests(ctx.user.organizationId, q);
  }

  @Post('privacy/requests')
  async create(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<SubjectRequestDto> {
    const input = parseBody(subjectRequestCreateSchema, body);
    await this.loadPatient(ctx, 'create', input.patientId);
    return this.privacy.createRequest(ctx, input);
  }

  @Post('privacy/requests/:id/resolve')
  @HttpCode(200)
  async resolve(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<SubjectRequestDto> {
    const request = await this.privacy.findRequest(ctx.user.organizationId, id);
    if (!request)
      return this.authz.notFound(ctx, 'edit', 'patient_rights', id, 'Pedido não encontrado.');
    await this.authz.authorize(ctx, 'edit', {
      type: 'patient_rights',
      id,
      patientId: request.patientId,
    });
    return this.privacy.resolveRequest(ctx, request, parseBody(subjectRequestResolveSchema, body));
  }

  @Get('patients/:id/access-report')
  async accessReport(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Query() query: unknown,
  ): Promise<AccessReportDto> {
    const q = parseBody(accessReportQuerySchema, query);
    const patient = await this.loadPatient(ctx, 'view', id);
    return this.privacy.accessReport(ctx.user.organizationId, patient, q);
  }

  /** Arquivo com os dados do paciente. Traz o CPF: exige reautenticação recente. */
  @Get('patients/:id/export')
  async export(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<StreamableFile> {
    await this.loadPatient(ctx, 'export', id);
    this.authz.requireRecentReauth(ctx);
    const data = await this.privacy.exportPatient(ctx, id);
    const day = data.generatedAt.slice(0, 10);
    return new StreamableFile(Buffer.from(JSON.stringify(data, null, 2), 'utf8'), {
      type: 'application/json; charset=utf-8',
      disposition: `attachment; filename="dados-do-paciente-${day}.json"`,
    });
  }

  private async loadPatient(
    ctx: AuthContext,
    action: 'view' | 'create' | 'export',
    patientId: string,
  ) {
    const patient = await this.privacy.findPatient(ctx.user.organizationId, patientId);
    if (!patient) {
      return this.authz.notFound(
        ctx,
        action,
        'patient_rights',
        patientId,
        'Paciente não encontrado.',
      );
    }
    await this.authz.authorize(ctx, action, { type: 'patient_rights', id: patientId, patientId });
    return patient;
  }
}
