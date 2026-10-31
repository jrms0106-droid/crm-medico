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
import {
  AI_FEATURES,
  type AiFeature,
  type AiFeatureDto,
  type AiRequestDto,
  ErrorCode,
  type MessageDraftDto,
  type RequestTriageDto,
  aiDecisionSchema,
  aiFeatureToggleSchema,
  messageDraftSchema,
  requestTriageSchema,
} from '@crm/shared';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../authz/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { AiService } from './ai.service.js';

/** IA nível 1, administrativa (docs/api/ia-nivel-1.md). Acesso sempre pela política. */
@Controller('ai')
export class AiController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
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

  @Post('requests/:id/decision')
  @HttpCode(200)
  async decide(
    @Auth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<AiRequestDto> {
    await this.authz.authorize(ctx, 'edit', { type: 'ai_assist', id });
    const row = await this.ai.find(ctx.user.organizationId, id);
    // Só quem pediu registra a decisão; de outra pessoa ou inexistente é 404.
    if (!row || row.userId !== ctx.user.id) {
      return this.authz.notFound(ctx, 'edit', 'ai_assist', id, 'Sugestão não encontrada.');
    }
    return this.ai.decide(ctx, row, parseBody(aiDecisionSchema, body));
  }

  @Get('requests')
  async list(@Auth() ctx: AuthContext): Promise<AiRequestDto[]> {
    await this.authz.authorize(ctx, 'view', { type: 'ai_assist' });
    return this.ai.list(ctx, ctx.user.roles.includes('admin'));
  }
}
