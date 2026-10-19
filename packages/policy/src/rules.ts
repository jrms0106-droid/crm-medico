import type {
  AccessRequest,
  Action,
  CareRelationshipState,
  DataClass,
  ResourceType,
  Role,
  Rule,
} from './types.js';

/** Como cada recurso é escopado por unidade. */
type UnitScope = 'none' | 'all_roles' | 'except_admin';

interface ResourceSpec {
  dataClass: DataClass;
  unitScope: UnitScope;
  /** Concessões por papel. O que não está aqui é negado. */
  grants: Partial<Record<Role, readonly Action[]>>;
}

const MANAGE: readonly Action[] = ['view', 'create', 'edit'];

/**
 * Matriz papel × recurso × ação. Fonte única, documentada em docs/api/organizacao-e-permissoes.md.
 * Exportar e compartilhar não estão concedidos a ninguém no MVP.
 */
export const RESOURCE_CATALOG: Readonly<Record<ResourceType, ResourceSpec>> = {
  unit: {
    dataClass: 'administrative',
    unitScope: 'except_admin',
    grants: { doctor: ['view'], secretary: ['view'], admin: MANAGE },
  },
  user_account: {
    dataClass: 'administrative',
    unitScope: 'none',
    grants: { admin: MANAGE },
  },
  specialty: {
    dataClass: 'administrative',
    unitScope: 'none',
    grants: { doctor: ['view'], secretary: ['view'], admin: MANAGE },
  },
  professional: {
    dataClass: 'administrative',
    unitScope: 'none',
    grants: { doctor: ['view'], secretary: ['view'], admin: MANAGE },
  },
  unit_professionals: {
    dataClass: 'administrative',
    unitScope: 'all_roles',
    grants: { doctor: ['view'], secretary: ['view'], admin: ['view'] },
  },
  patient_registration: {
    dataClass: 'personal',
    unitScope: 'none',
    grants: { doctor: MANAGE, secretary: MANAGE },
  },
  schedule: {
    dataClass: 'administrative',
    unitScope: 'all_roles',
    grants: { doctor: ['view'], secretary: MANAGE },
  },
  clinical_record: {
    dataClass: 'clinical',
    unitScope: 'none',
    grants: { doctor: ['view', 'create', 'edit', 'correct', 'sign'] },
  },
  audit_event: {
    dataClass: 'audit',
    unitScope: 'none',
    grants: { admin: ['view'] },
  },
};

export function dataClassOf(type: ResourceType): DataClass {
  return RESOURCE_CATALOG[type].dataClass;
}

/**
 * Estados do vínculo que liberam acesso clínico nesta etapa. A tabela completa por estado
 * (seção 5.2 da arquitetura) substitui esta lista na Etapa 5, após validação médica.
 */
const CARE_STATES_WITH_CLINICAL_ACCESS: readonly CareRelationshipState[] = ['started', 'follow_up'];

const deny = (reason: string) => ({ allowed: false, reason });

/** Nada atravessa a fronteira da organização. */
export const sameOrganization: Rule = ({ subject, resource }) =>
  subject.organizationId === resource.organizationId ? undefined : deny('other_organization');

/** Dado clínico só para quem tem o papel de médico; administrador nunca, por ser administrador. */
export const clinicalRequiresDoctor: Rule = ({ subject, resource }) => {
  if (dataClassOf(resource.type) !== 'clinical') return undefined;
  return subject.roles.includes('doctor') ? undefined : deny('clinical_requires_doctor');
};

/** Mesmo o médico só acessa dado clínico com vínculo assistencial em andamento. */
export const clinicalRequiresCareRelationship: Rule = ({ resource, context }) => {
  if (dataClassOf(resource.type) !== 'clinical') return undefined;
  const state = context?.careRelationship;
  return state && CARE_STATES_WITH_CLINICAL_ACCESS.includes(state)
    ? undefined
    : deny('no_care_relationship');
};

/**
 * Recursos operacionais de uma unidade exigem vínculo do usuário com aquela unidade.
 * Para `all_roles`, a unidade é obrigatória no pedido; para `except_admin` (a própria unidade),
 * o pedido sem unidade é uma listagem, que o serviço filtra pelas unidades do usuário.
 */
export const unitScope: Rule = ({ subject, resource }) => {
  const scope = RESOURCE_CATALOG[resource.type].unitScope;
  if (scope === 'none') return undefined;
  if (scope === 'except_admin' && subject.roles.includes('admin')) return undefined;
  if (resource.unitId === undefined) {
    return scope === 'all_roles' ? deny('unit_required') : undefined;
  }
  return subject.unitIds.includes(resource.unitId) ? undefined : deny('other_unit');
};

/** Concessão pela matriz de papéis. */
export const roleGrants: Rule = ({ subject, action, resource }: AccessRequest) => {
  const grants = RESOURCE_CATALOG[resource.type].grants;
  const role = subject.roles.find((r) => grants[r]?.includes(action));
  return role ? { allowed: true, reason: `role_${role}` } : undefined;
};

/** Regras em vigor. As negações vêm primeiro para que o motivo registrado seja o mais específico. */
export const RULES: readonly Rule[] = [
  sameOrganization,
  clinicalRequiresDoctor,
  clinicalRequiresCareRelationship,
  unitScope,
  roleGrants,
];
