import type { Rule } from '@crm/policy';

/**
 * Regras de acesso em vigor. Por enquanto só a administração de acesso de usuários (Etapa 1);
 * a matriz completa por papel e vínculo assistencial chega nas Etapas 2 e 5.
 */
export const adminManagesUserAccess: Rule = ({ subject, action, resource }) => {
  if (resource.type !== 'user_access') return undefined;
  if (action !== 'edit') return undefined;
  if (!subject.roles.includes('admin')) return { allowed: false, reason: 'not_admin' };
  return { allowed: true, reason: 'admin_manages_user_access' };
};

export const RULES: readonly Rule[] = [adminManagesUserAccess];
