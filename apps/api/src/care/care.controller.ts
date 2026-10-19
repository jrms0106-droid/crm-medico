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
} from '@nestjs/common';
import type { AccessContext, CareRelationshipState } from '@crm/policy';
import {
  type CareAccessDto,
  type EmergencyAccessDto,
  type EncounterDto,
  emergencyAccessSchema,
  emergencyReviewQuerySchema,
  emergencyReviewSchema,
  encounterCloseSchema,
} from '@crm/shared';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { CareService, encounterDto } from './care.service.js';

const uuid = new ParseUUIDPipe();

/** Um autor qualquer que não é o usuário, para perguntar à política sobre registros de terceiros. */
const SOMEONE_ELSE = '00000000-0000-0000-0000-000000000000';

/** A consulta é a base do vínculo para iniciar o atendimento. */
const STATE_FROM_APPOINTMENT: Partial<Record<string, CareRelationshipState>> = {
  scheduled: 'scheduled',
  confirmed: 'confirmed',
  arrived: 'confirmed',
};

@Controller()
export class CareController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CareService) private readonly care: CareService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
  ) {}

  @Post('appointments/:id/encounter')
  async start(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<EncounterDto> {
    const appointment = await this.scheduling.findAppointment(ctx.user.organizationId, id);
    if (!appointment) {
      return this.authz.notFound(ctx, 'create', 'encounter', id, 'Consulta não encontrada.');
    }
    await this.authz.authorize(
      ctx,
      'create',
      {
        type: 'encounter',
        id: appointment.id,
        unitId: appointment.unitId,
        patientId: appointment.patientId,
        ownerUserId: appointment.schedule.professional.userId,
      },
      { careRelationship: STATE_FROM_APPOINTMENT[appointment.status] },
    );
    return this.care.startEncounter(appointment, ctx.user.id);
  }

  @Get('encounters/:id')
  async get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<EncounterDto> {
    return encounterDto(await this.loadEncounter(ctx, 'view', id));
  }

  @Post('encounters/:id/close')
  @HttpCode(200)
  async close(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<EncounterDto> {
    const encounter = await this.loadEncounter(ctx, 'edit', id);
    const input = parseBody(encounterCloseSchema, body);
    return this.care.closeEncounter(encounter, input.followUpDays);
  }

  /** O que o usuário pode fazer no prontuário deste paciente agora. Não revela dado clínico. */
  @Get('patients/:id/care-access')
  async careAccess(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) patientId: string,
  ): Promise<CareAccessDto> {
    await this.authz.authorize(ctx, 'view', {
      type: 'patient_registration',
      id: patientId,
      patientId,
    });
    const org = ctx.user.organizationId;
    if (!(await this.care.patientExists(org, patientId))) {
      return this.authz.notFound(
        ctx,
        'view',
        'patient_registration',
        patientId,
        'Paciente não encontrado.',
      );
    }
    const isDoctor = ctx.user.roles.includes('doctor');
    const relationship = isDoctor
      ? await this.care.relationship(org, ctx.user.id, patientId)
      : { state: null, emergencyUntil: null };
    const context: AccessContext = {
      careRelationship: relationship.state ?? undefined,
      emergencyAccess: relationship.emergencyUntil !== null,
    };
    const can = (
      action: 'view' | 'create',
      type: 'clinical_summary' | 'clinical_record',
      extra: { authorUserId?: string; sensitivity?: 'normal' | 'elevated' } = {},
      ctxExtra: AccessContext = {},
    ) =>
      this.authz.check(ctx, action, { type, patientId, ...extra }, { ...context, ...ctxExtra })
        .allowed;
    const sensitive = { authorUserId: SOMEONE_ELSE, sensitivity: 'elevated' as const };
    return {
      state: relationship.state,
      emergencyUntil: relationship.emergencyUntil?.toISOString() ?? null,
      can: {
        viewSummary: can('view', 'clinical_summary'),
        viewHistory: can('view', 'clinical_record', {
          authorUserId: SOMEONE_ELSE,
          sensitivity: 'normal',
        }),
        createRecords: can('create', 'clinical_record'),
        viewOwnRecords: can('view', 'clinical_record', { authorUserId: ctx.user.id }),
        viewSensitiveOfOthers: can('view', 'clinical_record', sensitive)
          ? 'allowed'
          : can('view', 'clinical_record', sensitive, { justified: true })
            ? 'justification_required'
            : 'denied',
      },
    };
  }

  @Post('patients/:id/emergency-access')
  async emergency(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) patientId: string,
    @Body() body: unknown,
  ): Promise<EmergencyAccessDto> {
    await this.authz.authorize(ctx, 'create', { type: 'emergency_access', patientId });
    this.authz.requireRecentReauth(ctx);
    const input = parseBody(emergencyAccessSchema, body);
    const org = ctx.user.organizationId;
    if (!(await this.care.patientExists(org, patientId))) {
      return this.authz.notFound(
        ctx,
        'create',
        'emergency_access',
        patientId,
        'Paciente não encontrado.',
      );
    }
    const granted = await this.care.grantEmergency(
      org,
      ctx.user.id,
      patientId,
      input.justification,
    );
    await this.audit.record(ctx, {
      action: 'create',
      resourceType: 'emergency_access',
      resourceId: granted.id,
      patientId,
      outcome: 'allowed',
      reason: 'emergency_access_granted',
    });
    return granted;
  }

  @Get('emergency-access/reviews')
  async reviews(@Auth() ctx: AuthContext, @Query() query: unknown): Promise<EmergencyAccessDto[]> {
    await this.authz.authorize(ctx, 'view', { type: 'emergency_review' });
    const { status } = parseBody(emergencyReviewQuerySchema, query);
    return this.care.listEmergencies(ctx.user.organizationId, status);
  }

  @Post('emergency-access/:id/review')
  @HttpCode(200)
  async review(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<EmergencyAccessDto> {
    const access = await this.care.findEmergency(ctx.user.organizationId, id);
    if (!access) {
      return this.authz.notFound(ctx, 'edit', 'emergency_review', id, 'Acesso não encontrado.');
    }
    await this.authz.authorize(ctx, 'edit', {
      type: 'emergency_review',
      id,
      patientId: access.patientId,
    });
    return this.care.review(access, ctx.user.id, parseBody(emergencyReviewSchema, body));
  }

  /** Carrega o atendimento (404 auditado) e confere a permissão conforme o vínculo do usuário. */
  private async loadEncounter(ctx: AuthContext, action: 'view' | 'edit', id: string) {
    const encounter = await this.care.findEncounter(ctx.user.organizationId, id);
    if (!encounter) {
      return this.authz.notFound(ctx, action, 'encounter', id, 'Atendimento não encontrado.');
    }
    const context = ctx.user.roles.includes('doctor')
      ? await this.care.accessContext(ctx.user.organizationId, ctx.user.id, encounter.patientId)
      : {};
    await this.authz.authorize(
      ctx,
      action,
      {
        type: 'encounter',
        id,
        unitId: encounter.unitId,
        patientId: encounter.patientId,
        authorUserId: encounter.doctorUserId,
      },
      context,
    );
    return encounter;
  }
}
