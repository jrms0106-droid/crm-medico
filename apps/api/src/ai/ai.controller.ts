import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { ResourceType } from '@crm/policy';
import {
  AI_CLINICAL_FEATURES,
  AI_FEATURES,
  AI_RECEPTION_FEATURES,
  type AdminReportDto,
  type AiFeature,
  type AiFeatureDto,
  type AiRequestDto,
  ErrorCode,
  type MessageDraftDto,
  type RecordDraftSuggestionDto,
  type RecordSummarySuggestionDto,
  type RequestTriageDto,
  type ScheduleSuggestionsDto,
  adminReportSchema,
  aiDecisionSchema,
  aiFeatureToggleSchema,
  messageDraftSchema,
  recordDraftSuggestionSchema,
  recordSummarySuggestionSchema,
  requestTriageSchema,
  scheduleSuggestionsSchema,
} from '@crm/shared';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../authz/authorization.service.js';
import { CareService } from '../care/care.service.js';
import { AppError } from '../common/app-error.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { RecordsService } from '../records/records.service.js';
import { loadSchedule } from '../scheduling/scheduling.controller.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { AiClinicalService } from './ai-clinical.service.js';
import { AiInsightsService } from './ai-insights.service.js';
import { AiService } from './ai.service.js';

/** Quem usa cada funcionalidade, pela política (docs/api/ia-nivel-1.md e ia-nivel-2.md). */
function resourceOf(feature: AiFeature): ResourceType {
  if (AI_RECEPTION_FEATURES.includes(feature)) return 'ai_assist';
  if (AI_CLINICAL_FEATURES.includes(feature)) return 'ai_clinical';
  return 'ai_report';
}

/** Os três grupos de uso da IA, na ordem em que a decisão e o histórico os procuram. */
const AI_USE_RESOURCES: readonly ResourceType[] = ['ai_assist', 'ai_clinical', 'ai_report'];

/**
 * IA nível 1, administrativa (docs/api/ia-nivel-1.md), e nível 2, documental
 * (docs/api/ia-nivel-2.md). Acesso sempre pela política.
 */
@Controller('ai')
export class AiController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
    @Inject(AiInsightsService) private readonly insights: AiInsightsService,
    @Inject(AiClinicalService) private readonly clinical: AiClinicalService,
    @Inject(CareService) private readonly care: CareService,
    @Inject(RecordsService) private readonly records: RecordsService,
  ) {}

  @Get('features')
  async features(@Auth() ctx: AuthContext): Promise<AiFeatureDto[]> {
    await this.authz.authorize(ctx, 'view', { type: 'ai_settings' });
    return this.ai.features(ctx.user.organizationId);
  }

  @Put('features/:feature')
  async setFeature(
    @Auth() ctx: AuthContext,
    @Param('feature') feature: string,
    @Body() body: unknown,
  ): Promise<AiFeatureDto> {
    await this.authz.authorize(ctx, 'edit', { type: 'ai_settings', id: feature });
    if (!(AI_FEATURES as readonly string[]).includes(feature)) {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Funcionalidade de IA não encontrada.');
    }
    this.authz.requireRecentReauth(ctx);
    const { enabled } = parseBody(aiFeatureToggleSchema, body);
    const dto = await this.ai.setFeature(ctx, feature as AiFeature, enabled);
    await this.audit.record(ctx, {
      action: 'edit',
      resourceType: 'ai_settings',
      resourceId: feature,
      outcome: 'allowed',
      reason: enabled ? 'ai_feature_enabled' : 'ai_feature_disabled',
    });
    return dto;
  }

  @Post('message-drafts')
  @HttpCode(200)
  async draft(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<MessageDraftDto> {
    await this.authz.authorize(ctx, 'create', { type: 'ai_assist', id: 'message_draft' });
    const input = parseBody(messageDraftSchema, body);
    if (input.appointmentId) {
      // A consulta passa pela mesma política da agenda: outra unidade ou organização dá 403/404.
      const row = await this.scheduling.findAppointment(
        ctx.user.organizationId,
        input.appointmentId,
      );
      if (!row) {
        return this.authz.notFound(
          ctx,
          'view',
          'appointment',
          input.appointmentId,
          'Consulta não encontrada.',
        );
      }
      await this.authz.authorize(ctx, 'view', {
        type: 'appointment',
        id: row.id,
        unitId: row.unitId,
        patientId: row.patientId,
        ownerUserId: row.schedule.professional.userId,
      });
    }
    return this.ai.draftMessage(ctx, input);
  }

  @Post('request-triage')
  @HttpCode(200)
  async triage(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<RequestTriageDto> {
    await this.authz.authorize(ctx, 'create', { type: 'ai_assist', id: 'request_triage' });
    const { text } = parseBody(requestTriageSchema, body);
    return this.ai.triage(ctx, text);
  }

  @Post('schedule-suggestions')
  @HttpCode(200)
  async scheduleSuggestions(
    @Auth() ctx: AuthContext,
    @Body() body: unknown,
  ): Promise<ScheduleSuggestionsDto> {
    await this.authz.authorize(ctx, 'create', { type: 'ai_assist', id: 'schedule_suggestions' });
    const input = parseBody(scheduleSuggestionsSchema, body);
    // A agenda passa pela mesma política das consultas: outra unidade dá 403; outra org, 404.
    const schedule = await loadSchedule(
      this.authz,
      this.scheduling,
      ctx,
      'view',
      input.scheduleId,
      'appointment',
    );
    return this.insights.scheduleSuggestions(ctx, schedule, input.date);
  }

  @Post('admin-reports')
  @HttpCode(200)
  async adminReport(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<AdminReportDto> {
    await this.authz.authorize(ctx, 'create', { type: 'ai_report' });
    const input = parseBody(adminReportSchema, body);
    let timezone: string | null = null;
    if (input.unitId) {
      const unit = await this.scheduling.findUnit(ctx.user.organizationId, input.unitId);
      if (!unit) {
        return this.authz.notFound(ctx, 'view', 'unit', input.unitId, 'Unidade não encontrada.');
      }
      timezone = unit.timezone;
    }
    return this.insights.adminReport(ctx, input, timezone);
  }

  /**
   * Organizar anotações no registro: só o médico que pode criar registro para o paciente
   * (vínculo em atendimento iniciado ou acompanhamento).
   */
  @Post('clinical/record-draft')
  @HttpCode(200)
  async recordDraft(
    @Auth() ctx: AuthContext,
    @Body() body: unknown,
  ): Promise<RecordDraftSuggestionDto> {
    await this.authz.authorize(ctx, 'create', { type: 'ai_clinical', id: 'record_draft' });
    const input = parseBody(recordDraftSuggestionSchema, body);
    await this.requirePatient(ctx, 'create', input.patientId);
    await this.authz.authorize(
      ctx,
      'create',
      { type: 'clinical_record', patientId: input.patientId },
      await this.care.accessContext(ctx.user.organizationId, ctx.user.id, input.patientId),
    );
    return this.clinical.recordDraft(ctx, input.patientId, input.notes);
  }

  /**
   * Resumo do prontuário com fontes: exige vínculo que permita ver o prontuário. Entram só os
   * registros assinados que o médico pode ler sem justificativa; os sensíveis de outro médico são
   * contados.
   */
  @Post('clinical/record-summary')
  @HttpCode(200)
  async recordSummary(
    @Auth() ctx: AuthContext,
    @Body() body: unknown,
  ): Promise<RecordSummarySuggestionDto> {
    await this.authz.authorize(ctx, 'create', { type: 'ai_clinical', id: 'record_summary' });
    const { patientId } = parseBody(recordSummarySuggestionSchema, body);
    await this.requirePatient(ctx, 'view', patientId);
    const context = await this.care.accessContext(ctx.user.organizationId, ctx.user.id, patientId);
    // Mais estrito que a linha do tempo: sem vínculo valendo, nem os próprios registros vão à IA.
    await this.authz.authorize(ctx, 'view', { type: 'clinical_record', patientId }, context);
    const candidates = await this.records.timelineCandidates(
      ctx.user.organizationId,
      patientId,
      ctx.user.id,
      false,
    );
    let sensitiveHidden = 0;
    const readable = candidates.filter((record) => {
      if (record.status !== 'signed') return false;
      const ref = {
        type: 'clinical_record' as const,
        id: record.id,
        patientId,
        authorUserId: record.authorUserId,
        sensitivity: record.sensitivity,
      };
      if (this.authz.check(ctx, 'view', ref, context).allowed) return true;
      if (this.authz.check(ctx, 'view', ref, { ...context, justified: true }).allowed) {
        sensitiveHidden += 1;
      }
      return false;
    });
    return this.clinical.recordSummary(ctx, patientId, readable, sensitiveHidden);
  }

  @Post('requests/:id/decision')
  @HttpCode(200)
  async decide(
    @Auth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<AiRequestDto> {
    // Primeiro a política: quem não usa nenhuma funcionalidade nem chega a procurar o registro.
    const gate = this.useResource(ctx, 'edit');
    await this.authz.authorize(ctx, 'edit', { type: gate, id });
    const row = await this.ai.find(ctx.user.organizationId, id);
    // Só quem pediu registra a decisão; de outra pessoa ou inexistente é 404.
    if (!row || row.userId !== ctx.user.id) {
      return this.authz.notFound(ctx, 'edit', gate, id, 'Sugestão não encontrada.');
    }
    const type = resourceOf(row.feature);
    if (type !== gate) await this.authz.authorize(ctx, 'edit', { type, id });
    return this.ai.decide(ctx, row, parseBody(aiDecisionSchema, body));
  }

  @Get('requests')
  async list(@Auth() ctx: AuthContext): Promise<AiRequestDto[]> {
    await this.authz.authorize(ctx, 'view', { type: this.useResource(ctx, 'view') });
    return this.ai.list(ctx, ctx.user.roles.includes('admin'));
  }

  /** O grupo de uso da IA que a pessoa tem; sem nenhum, o primeiro, para a negação ser auditada. */
  private useResource(ctx: AuthContext, action: 'view' | 'edit'): ResourceType {
    return (
      AI_USE_RESOURCES.find((type) => this.authz.check(ctx, action, { type }).allowed) ??
      'ai_assist'
    );
  }

  private async requirePatient(ctx: AuthContext, action: 'view' | 'create', patientId: string) {
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
}
