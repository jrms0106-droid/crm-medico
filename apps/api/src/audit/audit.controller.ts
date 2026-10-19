import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type AuditEventDto, auditQuerySchema } from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { PrismaService } from '../database/prisma.service.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';

/** Consulta da trilha de auditoria da própria organização. O painel completo vem na Etapa 7. */
@Controller('audit/events')
export class AuditController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(@Auth() ctx: AuthContext, @Query() query: unknown): Promise<AuditEventDto[]> {
    await this.authz.authorize(ctx, 'view', { type: 'audit_event' });
    const q = parseBody(auditQuerySchema, query);
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        ...(q.outcome ? { outcome: q.outcome } : {}),
        ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
        ...(q.before ? { occurredAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { seq: 'desc' },
      take: q.limit,
    });
    return rows.map((e) => ({
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      actorUserId: e.actorUserId,
      requestId: e.requestId,
      ip: e.ip,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId,
      unitId: e.unitId,
      patientId: e.patientId,
      outcome: e.outcome,
      reason: e.reason,
    }));
  }
}
