/** Papéis base (RBAC). Ver docs/planejamento/03-arquitetura.md, seção 5.1. */
export const Role = {
  DOCTOR: 'doctor',
  SECRETARY: 'secretary',
  ADMIN: 'admin',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES: readonly Role[] = Object.values(Role);

/** Operações diferenciadas exigidas pela especificação. */
export const Action = {
  VIEW: 'view',
  CREATE: 'create',
  EDIT: 'edit',
  CORRECT: 'correct',
  SIGN: 'sign',
  EXPORT: 'export',
  SHARE: 'share',
} as const;
export type Action = (typeof Action)[keyof typeof Action];
export const ACTIONS: readonly Action[] = Object.values(Action);

/** Classe do dado protegido, usada para separar domínios administrativo, clínico etc. */
export type DataClass = 'administrative' | 'personal' | 'clinical' | 'financial' | 'ai' | 'audit';

/** Tipos de recurso conhecidos pela política. Ver docs/api/organizacao-e-permissoes.md. */
export const RESOURCE_TYPES = [
  'unit',
  'user_account',
  'specialty',
  'professional',
  'unit_professionals',
  'patient_registration',
  'schedule',
  'appointment',
  'encounter',
  'clinical_summary',
  'clinical_record',
  'medical_document',
  'emergency_access',
  'emergency_review',
  'audit_event',
  'price_item',
  'charge',
  'financial_report',
  'patient_rights',
  'communication',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/** Estados do vínculo assistencial (docs/api/atendimento-e-vinculo.md). */
export type CareRelationshipState =
  'scheduled' | 'confirmed' | 'started' | 'follow_up' | 'closed' | 'expired';

export interface Subject {
  userId: string;
  organizationId: string;
  roles: readonly Role[];
  unitIds: readonly string[];
}

export interface Resource {
  type: ResourceType;
  organizationId: string;
  unitId?: string | undefined;
  patientId?: string | undefined;
  /** Usuário dono do recurso, quando a regra depende disso (ex.: o médico da agenda). */
  ownerUserId?: string | undefined;
  /** Autor do registro clínico ou do atendimento. */
  authorUserId?: string | undefined;
  sensitivity?: Sensitivity | undefined;
}

/** Sensibilidade de um registro clínico. */
export type Sensitivity = 'normal' | 'elevated' | 'restricted';

export interface AccessContext {
  /** Estado do vínculo assistencial entre o usuário e o paciente do recurso, se houver. */
  careRelationship?: CareRelationshipState | undefined;
  /** Há acesso emergencial vigente do usuário para o paciente. */
  emergencyAccess?: boolean | undefined;
  /** O usuário registrou justificativa para este acesso (registros sensíveis de outros autores). */
  justified?: boolean | undefined;
}

export interface AccessRequest {
  subject: Subject;
  action: Action;
  resource: Resource;
  context?: AccessContext;
}

export interface Decision {
  allowed: boolean;
  /** Motivo legível por máquina, gravado na auditoria. */
  reason: string;
}

/** Uma regra devolve uma decisão quando se aplica, ou `undefined` quando não tem opinião. */
export type Rule = (request: AccessRequest) => Decision | undefined;
