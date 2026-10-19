import { Inject, Injectable } from '@nestjs/common';
import type { AuditChainReportDto } from '@crm/shared';
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
 * O encadeamento por hash é feito pelo banco, no gatilho `audit.chain_event` (docs/api/auditoria.md).
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

  /**
   * Percorre a cadeia da organização e devolve os elos quebrados: posição faltando (`gap`),
   * resumo anterior que não confere (`link`) ou conteúdo alterado (`content`). O resumo é
   * recalculado pela mesma função do banco que o gravou.
   */
  async verifyChain(organizationId: string): Promise<AuditChainReportDto> {
    const problems = await this.prisma.$queryRaw<
      { chain_seq: bigint; id: string; issue: 'gap' | 'link' | 'content' }[]
    >`
      WITH chain AS (
        SELECT e.id, e.chain_seq, e.hash, e.prev_hash,
               "audit"."event_digest"(e) AS expected,
               lag(e.hash) OVER w AS prev_actual,
               lag(e.chain_seq) OVER w AS prev_seq
          FROM "audit"."events" e
         WHERE e.organization_id = ${organizationId}::uuid
        WINDOW w AS (ORDER BY e.chain_seq)
      )
      SELECT chain_seq, id::text AS id,
             CASE
               WHEN chain_seq <> coalesce(prev_seq, 0) + 1 THEN 'gap'
               WHEN prev_hash IS DISTINCT FROM prev_actual THEN 'link'
               ELSE 'content'
             END AS issue
        FROM chain
       WHERE chain_seq <> coalesce(prev_seq, 0) + 1
          OR prev_hash IS DISTINCT FROM prev_actual
          OR hash <> expected
       ORDER BY chain_seq
       LIMIT 20`;
    const [summary] = await this.prisma.$queryRaw<
      { checked: bigint; head_seq: bigint | null; head_hash: string | null }[]
    >`
      SELECT count(*) AS checked,
             max(chain_seq) AS head_seq,
             (SELECT hash FROM "audit"."events"
               WHERE organization_id = ${organizationId}::uuid
               ORDER BY chain_seq DESC LIMIT 1) AS head_hash
        FROM "audit"."events"
       WHERE organization_id = ${organizationId}::uuid`;
    return {
      valid: problems.length === 0,
      checked: Number(summary?.checked ?? 0),
      headSeq: summary?.head_seq != null ? Number(summary.head_seq) : null,
      headHash: summary?.head_hash ?? null,
      problems: problems.map((p) => ({
        chainSeq: Number(p.chain_seq),
        eventId: p.id,
        issue: p.issue,
      })),
    };
  }
}
