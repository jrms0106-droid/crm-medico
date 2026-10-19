import { Injectable } from '@nestjs/common';
import { type AccessRequest, type Action, type Resource, type Role, decide } from '@crm/policy';
import { ErrorCode } from '@crm/shared';
import { AppError } from '../common/app-error.js';
import type { AuthContext } from '../identity/session.service.js';
import { RULES } from './rules.js';

/** Ponto único de decisão de acesso no backend. Nega por padrão. */
@Injectable()
export class AuthorizationService {
  assert(auth: AuthContext, action: Action, resource: Resource): void {
    const request: AccessRequest = {
      subject: { userId: auth.user.id, roles: auth.user.roles as Role[], unitIds: [] },
      action,
      resource,
    };
    const decision = decide(request, RULES);
    // A auditoria persistente de decisões (permitidas e negadas) entra na Etapa 7.
    if (!decision.allowed) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Você não tem permissão para esta operação.');
    }
  }
}
