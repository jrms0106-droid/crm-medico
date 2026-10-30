import {
  type HealthResponse,
  type MfaSetupResponse,
  type SessionInfo,
  errorResponseSchema,
  healthResponseSchema,
  mfaSetupResponseSchema,
  sessionInfoSchema,
} from '@crm/shared';
import { z } from 'zod';

/** Erro vindo da API, já com o código estável e a mensagem em português. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { field?: string | undefined; issue: string }[] = [],
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';

/** Chamado quando a sessão expira no meio do uso, para a tela voltar ao login. */
let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

// O token CSRF fica só em memória (nunca em localStorage) e vai em toda requisição que altera dados.
let csrfToken = '';

async function call<T extends z.ZodType>(
  method: Method,
  path: string,
  schema: T | null,
  body?: unknown,
): Promise<z.infer<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Verifique a internet.');
  }

  if (!res.ok) {
    const parsed = errorResponseSchema.safeParse(await res.json().catch(() => null));
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized();
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      throw new ApiError(res.status, code, message, details);
    }
    throw new ApiError(res.status, 'UNKNOWN', 'Erro inesperado. Tente novamente.');
  }
  if (res.status === 204 || schema === null) return undefined as z.infer<T>;
  return schema.parse(await res.json());
}

/**
 * Chamada às rotas de negócio. As respostas são do próprio backend, com os tipos de
 * `@crm/shared`; a validação de entrada fica no servidor.
 */
async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  return (await call(method, path, z.unknown(), body)) as T;
}

/** Monta a query string, ignorando valores vazios. */
export function query(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}

function remember(info: SessionInfo): SessionInfo {
  csrfToken = info.csrfToken;
  return info;
}

export const api = {
  health: (): Promise<HealthResponse> => call('GET', '/health', healthResponseSchema),
  me: async () => remember(await call('GET', '/auth/me', sessionInfoSchema)),
  login: async (email: string, password: string) =>
    remember(await call('POST', '/auth/login', sessionInfoSchema, { email, password })),
  logout: async () => {
    await call('POST', '/auth/logout', null);
    csrfToken = '';
  },
  mfaSetup: (): Promise<MfaSetupResponse> =>
    call('POST', '/auth/mfa/setup', mfaSetupResponseSchema),
  mfaActivate: async (code: string) =>
    remember(await call('POST', '/auth/mfa/activate', sessionInfoSchema, { code })),
  mfaVerify: async (code: string) =>
    remember(await call('POST', '/auth/mfa/verify', sessionInfoSchema, { code })),
  changePassword: async (currentPassword: string, newPassword: string) =>
    remember(
      await call('POST', '/auth/password', sessionInfoSchema, { currentPassword, newPassword }),
    ),
  reauth: (password: string, code?: string) =>
    call('POST', '/auth/reauth', null, { password, ...(code ? { code } : {}) }),
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
};
