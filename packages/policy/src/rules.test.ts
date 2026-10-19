import { describe, expect, it } from 'vitest';
import { decide } from './engine.js';
import { RULES } from './rules.js';
import {
  ACTIONS,
  type AccessRequest,
  type Action,
  type CareRelationshipState,
  RESOURCE_TYPES,
  ROLES,
  type ResourceType,
  type Role,
} from './types.js';

/**
 * Matriz esperada, escrita à parte do catálogo de regras de propósito: se alguém mudar o
 * catálogo sem atualizar a documentação (docs/api/organizacao-e-permissoes.md), este teste falha.
 * Letras: v=view c=create e=edit r=correct s=sign x=export h=share.
 */
const EXPECTED: Record<ResourceType, Record<Role, string>> = {
  unit: { doctor: 'v', secretary: 'v', admin: 'vce' },
  user_account: { doctor: '', secretary: '', admin: 'vce' },
  specialty: { doctor: 'v', secretary: 'v', admin: 'vce' },
  professional: { doctor: 'v', secretary: 'v', admin: 'vce' },
  unit_professionals: { doctor: 'v', secretary: 'v', admin: 'v' },
  patient_registration: { doctor: 'vce', secretary: 'vce', admin: '' },
  schedule: { doctor: 'v', secretary: 'vce', admin: 'vce' },
  appointment: { doctor: '', secretary: 'vce', admin: '' },
  clinical_record: { doctor: 'vcers', secretary: '', admin: '' },
  audit_event: { doctor: '', secretary: '', admin: 'v' },
};

const LETTER: Record<Action, string> = {
  view: 'v',
  create: 'c',
  edit: 'e',
  correct: 'r',
  sign: 's',
  export: 'x',
  share: 'h',
};

const ORG = 'org-1';
const UNIT = 'unit-a';

function request(
  roles: Role[],
  action: Action,
  type: ResourceType,
  opts: {
    unitIds?: string[];
    unitId?: string;
    organizationId?: string;
    care?: CareRelationshipState;
  } = {},
): AccessRequest {
  return {
    subject: { userId: 'u1', organizationId: ORG, roles, unitIds: opts.unitIds ?? [UNIT] },
    action,
    resource: {
      type,
      organizationId: opts.organizationId ?? ORG,
      unitId: 'unitId' in opts ? opts.unitId : UNIT,
      patientId: type === 'clinical_record' ? 'p1' : undefined,
    },
    context: { careRelationship: opts.care ?? 'started' },
  };
}

describe('matriz papel × recurso × ação (mesma organização, mesma unidade, vínculo em andamento)', () => {
  for (const type of RESOURCE_TYPES) {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        const expected = EXPECTED[type][role].includes(LETTER[action]);
        it(`${role} ${expected ? 'pode' : 'não pode'} ${action} em ${type}`, () => {
          expect(decide(request([role], action, type), RULES).allowed).toBe(expected);
        });
      }
    }
  }
});

describe('regras de atributo', () => {
  it('ninguém exporta nem compartilha nada no MVP', () => {
    for (const type of RESOURCE_TYPES) {
      for (const action of ['export', 'share'] as const) {
        expect(decide(request(['doctor', 'secretary', 'admin'], action, type), RULES).allowed).toBe(
          false,
        );
      }
    }
  });

  it('administrador não tem acesso clínico, mesmo com vínculo', () => {
    for (const action of ACTIONS) {
      expect(decide(request(['admin'], action, 'clinical_record'), RULES)).toEqual({
        allowed: false,
        reason: 'clinical_requires_doctor',
      });
    }
  });

  it('administrador que também é médico acessa pelo papel de médico', () => {
    expect(decide(request(['admin', 'doctor'], 'view', 'clinical_record'), RULES)).toEqual({
      allowed: true,
      reason: 'role_doctor',
    });
  });

  it('médico sem vínculo assistencial em andamento não acessa prontuário', () => {
    for (const care of ['scheduled', 'confirmed', 'closed', 'expired'] as const) {
      expect(decide(request(['doctor'], 'view', 'clinical_record', { care }), RULES)).toEqual({
        allowed: false,
        reason: 'no_care_relationship',
      });
    }
    const noContext = { ...request(['doctor'], 'view', 'clinical_record'), context: {} };
    expect(decide(noContext, RULES).reason).toBe('no_care_relationship');
  });

  it('médico com vínculo em acompanhamento ativo acessa prontuário', () => {
    const req = request(['doctor'], 'view', 'clinical_record', { care: 'follow_up' });
    expect(decide(req, RULES).allowed).toBe(true);
  });

  it('usuário de outra unidade é negado em recurso operacional da unidade alheia', () => {
    for (const role of ROLES) {
      const req = request([role], 'view', 'unit_professionals', { unitIds: ['unit-b'] });
      expect(decide(req, RULES)).toEqual({ allowed: false, reason: 'other_unit' });
    }
    const schedule = request(['secretary'], 'create', 'schedule', { unitIds: ['unit-b'] });
    expect(decide(schedule, RULES)).toEqual({ allowed: false, reason: 'other_unit' });
  });

  it('médico vê só as consultas da própria agenda, e não as altera', () => {
    const own = request(['doctor'], 'view', 'appointment');
    own.resource.ownerUserId = 'u1';
    expect(decide(own, RULES)).toEqual({ allowed: true, reason: 'own_schedule' });
    const other = request(['doctor'], 'view', 'appointment');
    other.resource.ownerUserId = 'u2';
    expect(decide(other, RULES).allowed).toBe(false);
    const edit = request(['doctor'], 'edit', 'appointment');
    edit.resource.ownerUserId = 'u1';
    expect(decide(edit, RULES).allowed).toBe(false);
    const elsewhere = request(['doctor'], 'view', 'appointment', { unitIds: ['unit-b'] });
    elsewhere.resource.ownerUserId = 'u1';
    expect(decide(elsewhere, RULES).reason).toBe('other_unit');
  });

  it('recurso operacional pedido sem unidade é negado', () => {
    const req = request(['secretary'], 'view', 'schedule', { unitId: undefined });
    expect(decide(req, RULES)).toEqual({ allowed: false, reason: 'unit_required' });
  });

  it('só o administrador vê unidades às quais não pertence', () => {
    const outsider = { unitIds: ['unit-b'] };
    expect(decide(request(['secretary'], 'view', 'unit', outsider), RULES).reason).toBe(
      'other_unit',
    );
    expect(decide(request(['admin'], 'edit', 'unit', outsider), RULES).allowed).toBe(true);
  });

  it('recurso de outra organização é negado para todos os papéis', () => {
    for (const type of RESOURCE_TYPES) {
      const req = request(['doctor', 'secretary', 'admin'], 'view', type, {
        organizationId: 'org-2',
      });
      expect(decide(req, RULES)).toEqual({ allowed: false, reason: 'other_organization' });
    }
  });

  it('usuário sem papéis não acessa nada', () => {
    for (const type of RESOURCE_TYPES) {
      for (const action of ACTIONS) {
        expect(decide(request([], action, type), RULES).allowed).toBe(false);
      }
    }
  });
});
