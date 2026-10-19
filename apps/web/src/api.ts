import { type HealthResponse, healthResponseSchema } from '@crm/shared';

/** Consulta a saúde da API e valida a resposta com o mesmo esquema usado no servidor. */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch('/api/v1/health', { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return healthResponseSchema.parse(await res.json());
}
