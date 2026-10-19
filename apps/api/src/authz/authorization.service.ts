import { Inject, Injectable } from '@nestjs/common';
import {
  type AccessContext,
  type AccessRequest,
  type Action,
  RULES,
  type ResourceType,
  type Role,
  decide,
} from '@crm/policy';
import { ErrorCode } from '@crm/shared';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/app-error.js';
import { SessionService } from '../identity/session.service.js';
import type { AuthContext } from '../identity/session.service.js';

export interface ResourceRef {
  type: ResourceType;
  /** Identificador do recurso específico, quando houver (vai para a auditoria). */
  id?: string | undefined;
  /** Organização dona do recurso; por padrão, a do usuário. */
  organizationId?: string | undefined;
  unitId?: string | undefined;
  patientId?: string | undefined;
  /** Usuário dono do recurso (ex.: o médico da agenda), para regras que dependem disso. */
  ownerUserId?: string | undefined;
}

/**
 * Ponto único de decisão de acesso no backend. Nega por padrão e audita toda decisão,
 * permitida ou negada.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async authorize(
    ctx: AuthContext,
    action: Action,
    resource: ResourceRef,
    context: AccessContext = {},
  ): Promise<void> {
    const request: AccessRequest = {
      subject: {
        userId: ctx.user.id,
        organizationId: ctx.user.organizationId,
        roles: ctx.user.roles as Role[],
        unitIds: ctx.unitIds,
      },
      action,
      resource: {
        type: resource.type,
        organizationId: resource.organizationId ?? ctx.user.organizationId,
        unitId: resource.unitId,
        patientId: resource.patientId,
        ownerUserId: resource.ownerUserId,
      },
      context,
    };
    const decision = decide(request, RULES);
    await this.audit.record(ctx, {
      action,
      resourceType: resource.type,
      resourceId: resource.id,
      unitId: resource.unitId,
      patientId: resource.patientId,
      outcome: decision.allowed ? 'allowed' : 'denied',
      reason: decision.reason,
    });
    if (!decision.allowed) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Você não tem permissão para esta operação.');
    }
  }

  /**
   * Registra a busca por um identificador que não existe no alcance do usuário (inexistente ou
   * de outra organização) e responde 404, sem revelar qual dos dois casos é.
   */
  async notFound(
    ctx: AuthContext,
    action: Action,
    type: ResourceType,
    id: string,
    message = 'Não encontrado.',
  ): Promise<never> {
    await this.audit.record(ctx, {
      action,
      resourceType: type,
      resourceId: id,
      outcome: 'not_found',
      reason: 'not_found_in_scope',
    });
    throw new AppError(404, ErrorCode.NOT_FOUND, message);
  }

  /** Alterações de permissão exigem reautenticação recente (docs/api/identidade.md). */
  requireRecentReauth(ctx: AuthContext): void {
    if (!this.sessions.hasRecentReauth(ctx.session)) {
      throw new AppError(
        403,
        ErrorCode.REAUTH_REQUIRED,
        'Confirme sua senha (e o código, se tiver) para continuar.',
      );
    }
  }
}
