import { timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type SessionState } from '@crm/shared';
import { AppError } from '../common/app-error.js';
import { ALLOWED_STATES_KEY, type AuthenticatedRequest, PUBLIC_KEY } from './auth.decorators.js';
import { SESSION_COOKIE } from './cookies.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const STATE_ERRORS: Record<Exclude<SessionState, 'active'>, () => AppError> = {
  pending_mfa: () =>
    new AppError(403, ErrorCode.MFA_REQUIRED, 'Confirme o código de verificação em duas etapas.'),
  password_change_required: () =>
    new AppError(
      403,
      ErrorCode.PASSWORD_CHANGE_REQUIRED,
      'Troque a senha temporária para continuar.',
    ),
};

/**
 * Guard global: toda rota exige sessão válida e no estado `active`, salvo marcação explícita.
 * Também exige o token CSRF em requisições que alteram dados.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'É preciso entrar no sistema.');
    }

    const auth = await this.sessions.resolve(token, {
      requestId: String(req.res?.locals['requestId'] ?? ''),
      ip: req.ip,
    });

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.header('x-csrf-token') ?? '';
      const expected = Buffer.from(auth.session.csrfToken);
      const given = Buffer.from(header);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw new AppError(
          403,
          ErrorCode.CSRF_FAILED,
          'Requisição recusada por segurança. Recarregue a página.',
        );
      }
    }

    const allowed = this.reflector.getAllAndOverride<SessionState[]>(
      ALLOWED_STATES_KEY,
      targets,
    ) ?? ['active'];
    if (!allowed.includes(auth.state)) {
      if (auth.state === 'active') {
        throw new AppError(409, ErrorCode.CONFLICT, 'Esta etapa do login já foi concluída.');
      }
      throw STATE_ERRORS[auth.state]();
    }

    req.auth = auth;
    return true;
  }
}
