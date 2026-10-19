import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuditOutcome } from '../generated/prisma/client.js';
import type { AuthContext } from '../identity/session.service.js';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | undefined;
  unitId?: string | undefined;
  patientId?: string | undefined;
  outcome: AuditOutcome;
  reason: string;
}

/**
 * Grava eventos na trilha de auditoria (somente-acréscimo). Se a gravação falhar, o erro sobe
 * e a operação não acontece: nenhum acesso fica sem registro.
 * O encadeamento por hash entra na Etapa 7.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async record(ctx: AuthContext, entry: AuditEntry): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        occurredAt: this.clock.now(),
        organizationId: ctx.user.organizationId,
        actorUserId: ctx.user.id,
        sessionId: ctx.session.id,
        requestId: ctx.request.requestId.slice(0, 64) || null,
        ip: ctx.request.ip?.slice(0, 64) ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId?.slice(0, 64) ?? null,
        unitId: entry.unitId ?? null,
        patientId: entry.patientId ?? null,
        outcome: entry.outcome,
        reason: entry.reason.slice(0, 100),
      },
    });
  }
}
