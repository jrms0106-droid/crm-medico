import {
  type HealthResponse,
  type MfaSetupResponse,
  type SessionInfo,
  errorResponseSchema,
  healthResponseSchema,
  mfaSetupResponseSchema,
  sessionInfoSchema,
} from '@crm/shared';
import type { z } from 'zod';

/** Erro vindo da API, já com o código estável e a mensagem em português. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// O token CSRF fica só em memória (nunca em localStorage) e vai em toda requisição que altera dados.
let csrfToken = '';

async function call<T extends z.ZodType>(
  method: 'GET' | 'POST',
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
    if (parsed.success) {
      throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message);
    }
    throw new ApiError(res.status, 'UNKNOWN', 'Erro inesperado. Tente novamente.');
  }
  if (res.status === 204 || schema === null) return undefined as z.infer<T>;
  return schema.parse(await res.json());
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
};
