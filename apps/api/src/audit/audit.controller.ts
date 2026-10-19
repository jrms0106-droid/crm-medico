import { Controller, Get, Inject, Query } from '@nestjs/common';
import { type AuditChainReportDto, type AuditEventDto, auditQuerySchema } from '@crm/shared';
import { AuditService } from './audit.service.js';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { PrismaService } from '../database/prisma.service.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';

/** Consulta e verificação da trilha de auditoria da própria organização (docs/api/auditoria.md). */
@Controller('audit')
export class AuditController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get('events')
  async list(@Auth() ctx: AuthContext, @Query() query: unknown): Promise<AuditEventDto[]> {
    await this.authz.authorize(ctx, 'view', { type: 'audit_event' });
    const q = parseBody(auditQuerySchema, query);
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        organizationId: ctx.user.organizationId,
        ...(q.outcome ? { outcome: q.outcome } : {}),
        ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
        ...(q.patientId ? { patientId: q.patientId } : {}),
        ...(q.resourceType ? { resourceType: q.resourceType } : {}),
        ...(q.action ? { action: q.action } : {}),
        ...(q.before || q.after
          ? {
              occurredAt: {
                ...(q.before ? { lt: new Date(q.before) } : {}),
                ...(q.after ? { gte: new Date(q.after) } : {}),
              },
            }
          : {}),
      },
      orderBy: { seq: 'desc' },
      take: q.limit,
    });
    return rows.map((e) => ({
      id: e.id,
      chainSeq: Number(e.chainSeq),
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

  @Get('verify')
  async verify(@Auth() ctx: AuthContext): Promise<AuditChainReportDto> {
    await this.authz.authorize(ctx, 'view', { type: 'audit_event' });
    return this.audit.verifyChain(ctx.user.organizationId);
  }
}
