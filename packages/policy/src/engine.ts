import type { AccessRequest, Decision, Rule } from './types.js';

export const DEFAULT_DENY: Decision = { allowed: false, reason: 'default_deny' };

/**
 * Avalia as regras em ordem. Qualquer negação explícita vence; sem nenhuma permissão
 * explícita, o resultado é negar (negação por padrão).
 * As regras reais de papéis e vínculo assistencial entram na Etapa 2 e na Etapa 5.
 */
export function decide(request: AccessRequest, rules: readonly Rule[]): Decision {
  let allow: Decision | undefined;
  for (const rule of rules) {
    let result: Decision | undefined;
    try {
      result = rule(request);
    } catch {
      return { allowed: false, reason: 'rule_error' };
    }
    if (!result) continue;
    if (!result.allowed) return result;
    allow ??= result;
  }
  return allow ?? DEFAULT_DENY;
}
