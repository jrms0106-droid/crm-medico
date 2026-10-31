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
import { type MessageDto, messageCancelSchema, messageListQuerySchema } from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { RemindersService } from './reminders.service.js';

/** Lembretes ao paciente (docs/api/crm-e-lembretes.md). Acesso sempre pela política. */
@Controller('crm')
export class CrmController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(RemindersService) private readonly reminders: RemindersService,
  ) {}

  @Get('messages')
  async list(@Auth() ctx: AuthContext, @Query() query: unknown): Promise<MessageDto[]> {
    const q = parseBody(messageListQuerySchema, query);
    await this.authz.authorize(ctx, 'view', {
      type: 'communication',
      ...(q.patientId ? { patientId: q.patientId } : {}),
    });
    return this.reminders.list(ctx, q);
  }

  @Post('messages/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Auth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<MessageDto> {
    const message = await this.reminders.find(ctx.user.organizationId, id);
    if (!message || !ctx.unitIds.includes(message.unitId)) {
      return this.authz.notFound(ctx, 'edit', 'communication', id, 'Lembrete não encontrado.');
    }
    await this.authz.authorize(ctx, 'edit', {
      type: 'communication',
      id,
      patientId: message.patientId,
    });
    return this.reminders.cancel(ctx, message, parseBody(messageCancelSchema, body).reason);
  }
}
