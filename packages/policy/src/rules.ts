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
 * Compartilhar não está concedido a ninguém. Exportar, só o PDF de documento médico.
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
    grants: { doctor: ['view'], secretary: MANAGE, admin: MANAGE },
  },
  // O médico vê só as consultas da própria agenda (regra doctorViewsOwnAppointments).
  appointment: {
    dataClass: 'personal',
    unitScope: 'all_roles',
    grants: { secretary: MANAGE },
  },
  // Os recursos clínicos abaixo dependem também do vínculo assistencial (careRelationshipAccess).
  encounter: {
    dataClass: 'clinical',
    unitScope: 'none',
    grants: { doctor: MANAGE },
  },
  clinical_summary: {
    dataClass: 'clinical',
    unitScope: 'none',
    grants: { doctor: ['view'] },
  },
  // Gerar a cópia do prontuário para o paciente é `export` (docs/api/direitos-do-titular.md).
  clinical_record: {
    dataClass: 'clinical',
    unitScope: 'none',
    grants: { doctor: ['view', 'create', 'edit', 'correct', 'sign', 'export'] },
  },
  medical_document: {
    dataClass: 'clinical',
    unitScope: 'none',
    grants: { doctor: ['view', 'create', 'edit', 'correct', 'sign', 'export'] },
  },
  emergency_access: {
    dataClass: 'clinical',
    unitScope: 'none',
    grants: { doctor: ['create'] },
  },
  emergency_review: {
    dataClass: 'audit',
    unitScope: 'none',
    grants: { admin: ['view', 'edit'] },
  },
  audit_event: {
    dataClass: 'audit',
    unitScope: 'none',
    grants: { admin: ['view'] },
  },
  // Financeiro particular (docs/api/financeiro.md). O médico não acessa nesta fase.
  price_item: {
    dataClass: 'financial',
    unitScope: 'none',
    grants: { secretary: ['view'], admin: MANAGE },
  },
  // Cobranças e pagamentos. Estornar pagamento é `correct`, só do administrador.
  charge: {
    dataClass: 'financial',
    unitScope: 'except_admin',
    grants: { secretary: MANAGE, admin: ['view', 'correct'] },
  },
  financial_report: {
    dataClass: 'financial',
    unitScope: 'except_admin',
    grants: { secretary: ['view'], admin: ['view'] },
  },
  // Pedidos do titular, relatório de acessos e exportação (docs/api/direitos-do-titular.md).
  // Exportar é `export`. O administrador não vê pacientes, então não atende pedidos.
  patient_rights: {
    dataClass: 'personal',
    unitScope: 'none',
    grants: { secretary: ['view', 'create', 'edit', 'export'] },
  },
};

export function dataClassOf(type: ResourceType): DataClass {
  return RESOURCE_CATALOG[type].dataClass;
}

type ClinicalType =
  'encounter' | 'clinical_summary' | 'clinical_record' | 'medical_document' | 'emergency_access';
type CareGrants = Partial<Record<ClinicalType, readonly Action[]>>;

const RECORD_WORK: readonly Action[] = ['view', 'create', 'edit', 'correct', 'sign'];
/** Documento médico: cancelar o assinado conta como `correct`; gerar o PDF, como `export`. */
const DOCUMENT_WORK: readonly Action[] = [...RECORD_WORK, 'export'];
/** Com o vínculo valendo, o médico também gera a cópia do prontuário pedida pelo paciente. */
const RECORD_WITH_COPY: readonly Action[] = [...RECORD_WORK, 'export'];

/**
 * O que cada estado do vínculo libera (docs/api/atendimento-e-vinculo.md). Proposta técnica,
 * pendente de validação médica.
 */
export const CARE_MATRIX: Readonly<Record<CareRelationshipState, CareGrants>> = {
  scheduled: { clinical_summary: ['view'], encounter: ['create'] },
  confirmed: { clinical_summary: ['view'], encounter: ['create'] },
  started: {
    clinical_summary: ['view'],
    clinical_record: RECORD_WITH_COPY,
    medical_document: DOCUMENT_WORK,
    encounter: ['view', 'edit'],
  },
  follow_up: {
    clinical_summary: ['view'],
    clinical_record: RECORD_WITH_COPY,
    medical_document: DOCUMENT_WORK,
    encounter: ['view'],
  },
  closed: {
    clinical_summary: ['view'],
    clinical_record: ['view', 'edit', 'correct', 'sign', 'export'],
    medical_document: ['view', 'edit', 'correct', 'sign', 'export'],
    encounter: ['view'],
  },
  expired: {},
};

/** Acesso emergencial: só leitura. */
const EMERGENCY_GRANTS: CareGrants = { clinical_summary: ['view'], clinical_record: ['view'] };

/** Pedir acesso emergencial não depende de vínculo. */
const ANY_STATE_GRANTS: CareGrants = { emergency_access: ['create'] };

/** Ações que só o autor faz sobre o próprio registro ou atendimento. */
const AUTHOR_ONLY: readonly Action[] = ['edit', 'correct', 'sign'];

const deny = (reason: string) => ({ allowed: false, reason });

/** Nada atravessa a fronteira da organização. */
export const sameOrganization: Rule = ({ subject, resource }) =>
  subject.organizationId === resource.organizationId ? undefined : deny('other_organization');

/** Dado clínico só para quem tem o papel de médico; administrador nunca, por ser administrador. */
export const clinicalRequiresDoctor: Rule = ({ subject, resource }) => {
  if (dataClassOf(resource.type) !== 'clinical') return undefined;
  return subject.roles.includes('doctor') ? undefined : deny('clinical_requires_doctor');
};

/**
 * Mesmo o médico só acessa dado clínico conforme o vínculo assistencial com o paciente.
 * Só nega; quem concede é a matriz de papéis.
 */
export const careRelationshipAccess: Rule = ({ subject, action, resource, context }) => {
  if (dataClassOf(resource.type) !== 'clinical') return undefined;
  const type = resource.type as ClinicalType;
  if (type === 'encounter' && resource.ownerUserId && resource.ownerUserId !== subject.userId) {
    return deny('not_own_schedule');
  }
  const isAuthor = resource.authorUserId === subject.userId;
  if (AUTHOR_ONLY.includes(action) && resource.authorUserId !== undefined && !isAuthor) {
    return deny('not_author');
  }
  // Obrigação documental: o autor sempre vê e adenda os próprios registros, e sempre vê, cancela
  // e gera o PDF dos próprios documentos.
  if (type === 'clinical_record' && isAuthor && (action === 'view' || action === 'correct')) {
    return undefined;
  }
  if (type === 'medical_document' && isAuthor && ['view', 'correct', 'export'].includes(action)) {
    return undefined;
  }
  const state = context?.careRelationship;
  const emergency = context?.emergencyAccess === true;
  const allowed = [
    ...(state ? (CARE_MATRIX[state][type] ?? []) : []),
    ...(emergency ? (EMERGENCY_GRANTS[type] ?? []) : []),
    ...(ANY_STATE_GRANTS[type] ?? []),
  ];
  if (!allowed.includes(action)) {
    return deny(state || emergency ? 'care_state_disallows' : 'no_care_relationship');
  }
  const sensitive = resource.sensitivity === 'elevated' || resource.sensitivity === 'restricted';
  if (type === 'clinical_record' && sensitive && !isAuthor && !context?.justified && !emergency) {
    return deny('justification_required');
  }
  return undefined;
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

/**
 * Quando só o acesso emergencial libera a leitura, a auditoria registra esse motivo, e não o
 * papel, para que a revisão encontre todo uso da quebra de vidro.
 */
export const emergencyAccessReason: Rule = ({ subject, action, resource, context }) => {
  if (dataClassOf(resource.type) !== 'clinical' || context?.emergencyAccess !== true) {
    return undefined;
  }
  if (!subject.roles.includes('doctor')) return undefined;
  const type = resource.type as ClinicalType;
  const byState = context.careRelationship
    ? (CARE_MATRIX[context.careRelationship][type] ?? [])
    : [];
  if (byState.includes(action) || !(EMERGENCY_GRANTS[type] ?? []).includes(action)) {
    return undefined;
  }
  return { allowed: true, reason: 'emergency_access' };
};

/** O médico vê as consultas da própria agenda, e só elas. */
export const doctorViewsOwnAppointments: Rule = ({ subject, action, resource }) => {
  if (resource.type !== 'appointment' || action !== 'view') return undefined;
  if (!subject.roles.includes('doctor')) return undefined;
  return resource.ownerUserId === subject.userId
    ? { allowed: true, reason: 'own_schedule' }
    : undefined;
};

/** Regras em vigor. As negações vêm primeiro para que o motivo registrado seja o mais específico. */
export const RULES: readonly Rule[] = [
  sameOrganization,
  clinicalRequiresDoctor,
  careRelationshipAccess,
  unitScope,
  emergencyAccessReason,
  roleGrants,
  doctorViewsOwnAppointments,
];
