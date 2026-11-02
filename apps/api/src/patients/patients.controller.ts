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
} from '@nestjs/common';
import {
  type PatientDto,
  type PatientSummaryDto,
  type PatientVersionDto,
  type PatientImportResultDto,
  duplicateCheckSchema,
  patientCreateSchema,
  patientImportSchema,
  patientSearchSchema,
  patientUpdateSchema,
} from '@crm/shared';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import { PatientImportService } from '../integrations/patient-import.service.js';
import type { AuthContext } from '../identity/session.service.js';
import { PatientsService } from './patients.service.js';

const uuid = new ParseUUIDPipe();
const TYPE = 'patient_registration';
const NOT_FOUND = 'Paciente não encontrado.';

@Controller('patients')
export class PatientsController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PatientsService) private readonly patients: PatientsService,
    @Inject(PatientImportService) private readonly imports: PatientImportService,
  ) {}

  /** Confere a planilha linha por linha, sem gravar nada (docs/api/integracoes.md). */
  @Post('import/preview')
  @HttpCode(200)
  async importPreview(
    @Auth() ctx: AuthContext,
    @Body() body: unknown,
  ): Promise<PatientImportResultDto> {
    await this.authz.authorize(ctx, 'create', { type: 'patient_import' });
    const { csv } = parseBody(patientImportSchema, body);
    return this.imports.preview(ctx, csv);
  }

  /** Cadastra só as linhas sem erro e sem duplicidade; devolve o resultado por linha. */
  @Post('import')
  @HttpCode(200)
  async importCommit(
    @Auth() ctx: AuthContext,
    @Body() body: unknown,
  ): Promise<PatientImportResultDto> {
    await this.authz.authorize(ctx, 'create', { type: 'patient_import' });
    const { csv } = parseBody(patientImportSchema, body);
    return this.imports.commit(ctx, csv);
  }

  /** Busca pelo corpo: CPF e telefone não vão no endereço (ADR 0033). */
  @Post('search')
  @HttpCode(200)
  async search(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<PatientSummaryDto[]> {
    await this.authz.authorize(ctx, 'view', { type: TYPE });
    return this.patients.search(ctx.user.organizationId, parseBody(patientSearchSchema, body));
  }

  @Post('duplicate-check')
  async duplicateCheck(
    @Auth() ctx: AuthContext,
    @Body() body: unknown,
  ): Promise<PatientSummaryDto[]> {
    await this.authz.authorize(ctx, 'create', { type: TYPE });
    const probe = parseBody(duplicateCheckSchema, body);
    const org = ctx.user.organizationId;
    const similar = await this.patients.findSimilar(org, probe);
    const cpfOwner = probe.cpf ? await this.patients.cpfOwner(org, probe.cpf) : null;
    if (cpfOwner && !similar.some((s) => s.id === cpfOwner)) {
      const owner = await this.patients.search(org, {
        q: probe.cpf ?? '',
        includeInactive: true,
        limit: 1,
      });
      return [...owner, ...similar];
    }
    return similar;
  }

  @Post()
  async create(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<PatientDto> {
    await this.authz.authorize(ctx, 'create', { type: TYPE });
    const input = parseBody(patientCreateSchema, body);
    const patient = await this.patients.create(ctx.user.organizationId, ctx.user.id, input);
    await this.audit.record(ctx, {
      action: 'create',
      resourceType: TYPE,
      resourceId: patient.id,
      patientId: patient.id,
      outcome: 'allowed',
      reason: input.allowPossibleDuplicate
        ? 'patient_created_despite_duplicate_alert'
        : 'patient_created',
    });
    return patient;
  }

  @Get(':id')
  async get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<PatientDto> {
    return this.load(ctx, 'view', id);
  }

  @Patch(':id')
  async update(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<PatientDto> {
    const current = await this.load(ctx, 'edit', id);
    const input = parseBody(patientUpdateSchema, body);
    return this.patients.update(ctx.user.organizationId, ctx.user.id, current, input);
  }

  @Get(':id/history')
  async history(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
  ): Promise<PatientVersionDto[]> {
    await this.load(ctx, 'view', id);
    return this.patients.history(id);
  }

  /**
   * Confere a permissão (auditada com o id do paciente) antes de revelar se o cadastro existe;
   * id de outra organização ou inexistente vira 404 auditado.
   */
  private async load(ctx: AuthContext, action: 'view' | 'edit', id: string): Promise<PatientDto> {
    await this.authz.authorize(ctx, action, { type: TYPE, id, patientId: id });
    const patient = await this.patients.find(ctx.user.organizationId, id);
    return patient ?? this.authz.notFound(ctx, action, TYPE, id, NOT_FOUND);
  }
}
