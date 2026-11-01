import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '@crm/shared';
import { type Observable, map } from 'rxjs';
import { AppError } from '../common/app-error.js';
import { type AuthenticatedRequest, PUBLIC_KEY } from '../identity/auth.decorators.js';

const SELF_SERVICE_KEY = 'authz:self-service';

/**
 * Rota que só mexe na própria sessão (sair, trocar a senha, configurar o MFA): não há recurso
 * de outra pessoa para autorizar. Toda outra rota com login precisa passar pela política.
 */
export const SelfService = () => SetMetadata(SELF_SERVICE_KEY, true);

const checked = new WeakSet<object>();

/** Chamado pelo serviço de autorização a cada decisão (permitida, negada ou não encontrada). */
export function markAuthorizationChecked(ctx: object): void {
  checked.add(ctx);
}

/**
 * Negação por padrão também para quem esquece: se uma rota com login termina sem nenhuma
 * decisão da política, a resposta é trocada por 403 e o erro vai para o registro. Assim uma
 * rota nova sem `authorize` falha nos testes em vez de abrir dados.
 */
@Injectable()
export class AuthorizationEnforcedInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Autorizacao');

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const targets = [context.getHandler(), context.getClass()];
    const exempt =
      this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) ||
      this.reflector.getAllAndOverride<boolean>(SELF_SERVICE_KEY, targets);
    if (exempt || context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return next.handle().pipe(
      map((value: unknown) => {
        if (!req.auth || !checked.has(req.auth)) {
          this.logger.error(
            `Rota sem decisão de autorização: ${req.method} ${req.route?.path ?? '?'}`,
          );
          throw new AppError(
            403,
            ErrorCode.FORBIDDEN,
            'Você não tem permissão para esta operação.',
          );
        }
        return value;
      }),
    );
  }
}
