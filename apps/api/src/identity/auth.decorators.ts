import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { SessionState } from '@crm/shared';
import type { Request } from 'express';
import type { AuthContext } from './session.service.js';

export const PUBLIC_KEY = 'auth:public';
export const ALLOWED_STATES_KEY = 'auth:states';

/** Rota acessível sem login (ex.: verificação de saúde, o próprio login). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Por padrão só sessões `active` passam; use para liberar etapas intermediárias do login. */
export const AllowStates = (...states: SessionState[]) => SetMetadata(ALLOWED_STATES_KEY, states);

export type AuthenticatedRequest = Request & { auth?: AuthContext };

/** Injeta o contexto de autenticação já validado pelo guard. */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.auth) throw new Error('Rota sem contexto de autenticação: falta o AuthGuard.');
  return req.auth;
});
