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
  Put,
  Query,
} from '@nestjs/common';
import type { Action } from '@crm/policy';
import {
  type AppointmentDto,
  type AppointmentEventDto,
  type ScheduleDto,
  type WaitlistEntryDto,
  appointmentCancelSchema,
  appointmentCreateSchema,
  appointmentRangeSchema,
  appointmentRescheduleSchema,
  availabilityQuerySchema,
  blockCreateSchema,
  scheduleCreateSchema,
  scheduleRulesSchema,
  scheduleUpdateSchema,
  waitlistCreateSchema,
  waitlistRemoveSchema,
} from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import {
  type AppointmentRow,
  type ScheduleRow,
  SchedulingService,
  appointmentDto,
} from './scheduling.service.js';

const uuid = new ParseUUIDPipe();

/**
 * Carrega a agenda da organização (404 auditado se não existir) e confere a permissão na
 * unidade dela. Compartilhado pelos controllers abaixo.
 */
export async function loadSchedule(
  authz: AuthorizationService,
  scheduling: SchedulingService,
  ctx: AuthContext,
  action: Action,
  id: string,
  type: 'schedule' | 'appointment' = 'schedule',
): Promise<ScheduleRow> {
  const schedule = await scheduling.findSchedule(ctx.user.organizationId, id);
  if (!schedule) return authz.notFound(ctx, action, 'schedule', id, 'Agenda não encontrada.');
  await authz.authorize(ctx, action, {
    type,
    id: schedule.id,
    unitId: schedule.unitId,
    ownerUserId: schedule.professional.userId,
  });
  return schedule;
}

async function loadUnit(
  authz: AuthorizationService,
  scheduling: SchedulingService,
  ctx: AuthContext,
  action: Action,
  type: 'schedule' | 'appointment',
  unitId: string,
): Promise<void> {
  const unit = await scheduling.findUnit(ctx.user.organizationId, unitId);
  if (!unit) return authz.notFound(ctx, action, 'unit', unitId, 'Unidade não encontrada.');
  await authz.authorize(ctx, action, { type, unitId });
}

@Controller('units/:unitId')
export class UnitSchedulingController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
  ) {}

  @Get('schedules')
  async list(
    @Auth() ctx: AuthContext,
    @Param('unitId', uuid) unitId: string,
  ): Promise<ScheduleDto[]> {
    await loadUnit(this.authz, this.scheduling, ctx, 'view', 'schedule', unitId);
    return this.scheduling.listSchedules(ctx.user.organizationId, unitId);
  }

  @Post('schedules')
  async create(
    @Auth() ctx: AuthContext,
    @Param('unitId', uuid) unitId: string,
    @Body() body: unknown,
  ): Promise<ScheduleDto> {
    await loadUnit(this.authz, this.scheduling, ctx, 'create', 'schedule', unitId);
    const input = parseBody(scheduleCreateSchema, body);
    return this.scheduling.createSchedule(ctx.user.organizationId, unitId, input);
  }

  @Get('waitlist')
  async waitlist(
    @Auth() ctx: AuthContext,
    @Param('unitId', uuid) unitId: string,
  ): Promise<WaitlistEntryDto[]> {
    await loadUnit(this.authz, this.scheduling, ctx, 'view', 'appointment', unitId);
    return this.scheduling.listWaitlist(ctx.user.organizationId, unitId);
  }

  @Post('waitlist')
  async addToWaitlist(
    @Auth() ctx: AuthContext,
    @Param('unitId', uuid) unitId: string,
    @Body() body: unknown,
  ): Promise<WaitlistEntryDto> {
    const input = parseBody(waitlistCreateSchema, body);
    const unit = await this.scheduling.findUnit(ctx.user.organizationId, unitId);
    if (!unit) {
      return this.authz.notFound(ctx, 'create', 'unit', unitId, 'Unidade não encontrada.');
    }
    await this.authz.authorize(ctx, 'create', {
      type: 'appointment',
      unitId,
      patientId: input.patientId,
    });
    return this.scheduling.addToWaitlist(ctx.user.organizationId, unitId, ctx.user.id, input);
  }
}

@Controller('schedules/:id')
export class SchedulesController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
  ) {}

  @Patch()
  async update(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<ScheduleDto> {
    const schedule = await loadSchedule(this.authz, this.scheduling, ctx, 'edit', id);
    return this.scheduling.updateSchedule(schedule, parseBody(scheduleUpdateSchema, body));
  }

  @Put('rules')
  async rules(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<ScheduleDto> {
    const schedule = await loadSchedule(this.authz, this.scheduling, ctx, 'edit', id);
    return this.scheduling.replaceRules(schedule, parseBody(scheduleRulesSchema, body));
  }

  @Post('blocks')
  async block(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<ScheduleDto['blocks'][number]> {
    const schedule = await loadSchedule(this.authz, this.scheduling, ctx, 'edit', id);
    return this.scheduling.createBlock(schedule, ctx.user.id, parseBody(blockCreateSchema, body));
  }

  @Post('blocks/:blockId/remove')
  @HttpCode(204)
  async removeBlock(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Param('blockId', uuid) blockId: string,
  ): Promise<void> {
    const schedule = await loadSchedule(this.authz, this.scheduling, ctx, 'edit', id);
    if (!(await this.scheduling.removeBlock(schedule, blockId, ctx.user.id))) {
      await this.authz.notFound(ctx, 'edit', 'schedule', blockId, 'Bloqueio não encontrado.');
    }
  }

  @Get('availability')
  async availability(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Query() query: unknown,
  ): Promise<{ startsAt: string; endsAt: string }[]> {
    const schedule = await loadSchedule(this.authz, this.scheduling, ctx, 'view', id);
    return this.scheduling.availability(schedule, parseBody(availabilityQuerySchema, query).date);
  }

  @Get('appointments')
  async appointments(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Query() query: unknown,
  ): Promise<AppointmentDto[]> {
    const schedule = await loadSchedule(
      this.authz,
      this.scheduling,
      ctx,
      'view',
      id,
      'appointment',
    );
    const range = parseBody(appointmentRangeSchema, query);
    return this.scheduling.listAppointments(schedule, new Date(range.from), new Date(range.to));
  }
}

@Controller('appointments')
export class AppointmentsController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
  ) {}

  @Post()
  async create(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<AppointmentDto> {
    const input = parseBody(appointmentCreateSchema, body);
    const schedule = await this.scheduling.findSchedule(ctx.user.organizationId, input.scheduleId);
    if (!schedule) {
      return this.authz.notFound(
        ctx,
        'create',
        'schedule',
        input.scheduleId,
        'Agenda não encontrada.',
      );
    }
    await this.authz.authorize(ctx, 'create', {
      type: 'appointment',
      unitId: schedule.unitId,
      patientId: input.patientId,
    });
    return this.scheduling.createAppointment(ctx.user.organizationId, ctx.user.id, schedule, input);
  }

  @Get(':id')
  async get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<AppointmentDto> {
    const { dto } = await this.load(ctx, 'view', id);
    return dto;
  }

  @Get(':id/history')
  async history(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
  ): Promise<AppointmentEventDto[]> {
    await this.load(ctx, 'view', id);
    return this.scheduling.history(id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<AppointmentDto> {
    const { row } = await this.load(ctx, 'edit', id);
    return this.scheduling.confirm(row, ctx.user.id);
  }

  @Post(':id/check-in')
  @HttpCode(200)
  async checkIn(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<AppointmentDto> {
    const { row } = await this.load(ctx, 'edit', id);
    return this.scheduling.checkIn(row, ctx.user.id);
  }

  @Post(':id/no-show')
  @HttpCode(200)
  async noShow(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<AppointmentDto> {
    const { row } = await this.load(ctx, 'edit', id);
    return this.scheduling.noShow(row, ctx.user.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<AppointmentDto> {
    const { row } = await this.load(ctx, 'edit', id);
    return this.scheduling.cancel(row, ctx.user.id, parseBody(appointmentCancelSchema, body));
  }

  @Post(':id/reschedule')
  async reschedule(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<AppointmentDto> {
    const { row } = await this.load(ctx, 'edit', id);
    const input = parseBody(appointmentRescheduleSchema, body);
    let target = await this.scheduling.findSchedule(ctx.user.organizationId, row.scheduleId);
    if (input.scheduleId && input.scheduleId !== row.scheduleId) {
      target = await this.scheduling.findSchedule(ctx.user.organizationId, input.scheduleId);
      if (!target) {
        return this.authz.notFound(
          ctx,
          'create',
          'schedule',
          input.scheduleId,
          'Agenda não encontrada.',
        );
      }
      await this.authz.authorize(ctx, 'create', {
        type: 'appointment',
        unitId: target.unitId,
        patientId: row.patientId,
      });
    }
    if (!target) throw new Error('Agenda da consulta não encontrada.');
    return this.scheduling.reschedule(row, ctx.user.id, target, input);
  }

  /** Carrega a consulta (404 auditado) e confere a permissão na unidade, com o paciente. */
  private async load(ctx: AuthContext, action: Action, id: string) {
    const row: AppointmentRow | null = await this.scheduling.findAppointment(
      ctx.user.organizationId,
      id,
    );
    if (!row)
      return this.authz.notFound(ctx, action, 'appointment', id, 'Consulta não encontrada.');
    await this.authz.authorize(ctx, action, {
      type: 'appointment',
      id,
      unitId: row.unitId,
      patientId: row.patientId,
      ownerUserId: row.schedule.professional.userId,
    });
    return { row, dto: appointmentDto(row) };
  }
}

@Controller('waitlist')
export class WaitlistController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(SchedulingService) private readonly scheduling: SchedulingService,
  ) {}

  @Post(':id/remove')
  @HttpCode(204)
  async remove(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const entry = await this.scheduling.findWaitlistEntry(ctx.user.organizationId, id);
    if (!entry) {
      await this.authz.notFound(ctx, 'edit', 'appointment', id, 'Entrada não encontrada.');
      return;
    }
    await this.authz.authorize(ctx, 'edit', {
      type: 'appointment',
      id,
      unitId: entry.unitId,
      patientId: entry.patientId,
    });
    await this.scheduling.removeFromWaitlist(id, parseBody(waitlistRemoveSchema, body).reason);
  }
}
