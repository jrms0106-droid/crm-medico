/** Papéis base (RBAC). Ver docs/planejamento/03-arquitetura.md, seção 5.1. */
export const Role = {
  DOCTOR: 'doctor',
  SECRETARY: 'secretary',
  ADMIN: 'admin',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

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

/** Classe do dado protegido, usada para separar domínios administrativo, clínico etc. */
export type DataClass = 'administrative' | 'personal' | 'clinical' | 'financial' | 'ai' | 'audit';

export interface Subject {
  userId: string;
  roles: readonly Role[];
  unitIds: readonly string[];
}

export interface Resource {
  type: string;
  dataClass: DataClass;
  unitId?: string;
  patientId?: string;
}

export interface AccessRequest {
  subject: Subject;
  action: Action;
  resource: Resource;
}

export interface Decision {
  allowed: boolean;
  /** Motivo legível por máquina, gravado na auditoria. */
  reason: string;
}

/** Uma regra devolve uma decisão quando se aplica, ou `undefined` quando não tem opinião. */
export type Rule = (request: AccessRequest) => Decision | undefined;
