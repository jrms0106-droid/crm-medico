import { describe, expect, it } from 'vitest';
import { decide } from './engine.js';
import { RULES, dataClassOf } from './rules.js';
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
  encounter: { doctor: 've', secretary: '', admin: '' },
  clinical_summary: { doctor: 'v', secretary: '', admin: '' },
  clinical_record: { doctor: 'vcers', secretary: '', admin: '' },
  emergency_access: { doctor: 'c', secretary: '', admin: '' },
  emergency_review: { doctor: '', secretary: '', admin: 've' },
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
      patientId: dataClassOf(type) === 'clinical' ? 'p1' : undefined,
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

  it('médico sem vínculo assistencial não acessa nada clínico, só pede acesso emergencial', () => {
    for (const type of ['clinical_summary', 'clinical_record', 'encounter'] as const) {
      for (const action of ACTIONS) {
        const req = { ...request(['doctor'], action, type), context: {} };
        expect(decide(req, RULES)).toEqual({ allowed: false, reason: 'no_care_relationship' });
      }
    }
    const ask = { ...request(['doctor'], 'create', 'emergency_access'), context: {} };
    expect(decide(ask, RULES).allowed).toBe(true);
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

/**
 * Um caso por estado do vínculo (docs/api/atendimento-e-vinculo.md), sobre registros de outro
 * autor com sensibilidade normal. Letras como na matriz acima.
 */
const BY_STATE: Record<
  CareRelationshipState,
  Record<'summary' | 'record' | 'encounter', string>
> = {
  scheduled: { summary: 'v', record: '', encounter: 'c' },
  confirmed: { summary: 'v', record: '', encounter: 'c' },
  started: { summary: 'v', record: 'vc', encounter: 'v' },
  follow_up: { summary: 'v', record: 'vc', encounter: 'v' },
  closed: { summary: 'v', record: 'v', encounter: 'v' },
  expired: { summary: '', record: '', encounter: '' },
};

function clinical(
  action: Action,
  type: 'clinical_summary' | 'clinical_record' | 'encounter',
  context: AccessRequest['context'],
  resource: Partial<AccessRequest['resource']> = {},
): AccessRequest {
  return {
    subject: { userId: 'u1', organizationId: ORG, roles: ['doctor'], unitIds: [UNIT] },
    action,
    resource: { type, organizationId: ORG, patientId: 'p1', ...resource },
    context,
  };
}

describe('o que o médico vê e faz em cada estado do vínculo', () => {
  const states = Object.keys(BY_STATE) as CareRelationshipState[];
  for (const state of states) {
    it(`estado ${state}`, () => {
      const expected = BY_STATE[state];
      for (const action of ['view', 'create'] as const) {
        const ctx = { careRelationship: state };
        const summary = decide(clinical(action, 'clinical_summary', ctx), RULES).allowed;
        expect(summary, `resumo ${action}`).toBe(expected.summary.includes(LETTER[action]));
        const other = { authorUserId: 'u2', sensitivity: 'normal' as const };
        const record = decide(clinical(action, 'clinical_record', ctx, other), RULES).allowed;
        expect(record, `registro ${action}`).toBe(expected.record.includes(LETTER[action]));
        const encounter = decide(clinical(action, 'encounter', ctx), RULES).allowed;
        expect(encounter, `atendimento ${action}`).toBe(
          expected.encounter.includes(LETTER[action]),
        );
      }
    });
  }

  it('agendamento não libera o histórico completo', () => {
    for (const state of ['scheduled', 'confirmed'] as const) {
      expect(
        decide(clinical('view', 'clinical_record', { careRelationship: state }), RULES),
      ).toEqual({ allowed: false, reason: 'care_state_disallows' });
    }
  });

  it('vínculo expirado: só os registros de sua autoria, para ver e adendar', () => {
    const ctx = { careRelationship: 'expired' as const };
    const own = { authorUserId: 'u1' };
    expect(decide(clinical('view', 'clinical_record', ctx, own), RULES).allowed).toBe(true);
    expect(decide(clinical('correct', 'clinical_record', ctx, own), RULES).allowed).toBe(true);
    expect(decide(clinical('edit', 'clinical_record', ctx, own), RULES).allowed).toBe(false);
    expect(decide(clinical('sign', 'clinical_record', ctx, own), RULES).allowed).toBe(false);
    const other = { authorUserId: 'u2' };
    expect(decide(clinical('view', 'clinical_record', ctx, other), RULES).allowed).toBe(false);
  });

  it('encerrado: termina e assina os próprios, mas não cria registros novos', () => {
    const ctx = { careRelationship: 'closed' as const };
    expect(decide(clinical('create', 'clinical_record', ctx), RULES).allowed).toBe(false);
    const own = { authorUserId: 'u1' };
    for (const action of ['edit', 'sign', 'correct'] as const) {
      expect(decide(clinical(action, 'clinical_record', ctx, own), RULES).allowed).toBe(true);
    }
  });

  it('editar, adendar e assinar só os próprios registros', () => {
    const ctx = { careRelationship: 'started' as const };
    for (const action of ['edit', 'correct', 'sign'] as const) {
      const req = clinical(action, 'clinical_record', ctx, { authorUserId: 'u2' });
      expect(decide(req, RULES)).toEqual({ allowed: false, reason: 'not_author' });
    }
  });

  it('registro sensível de outro autor exige justificativa, mesmo com vínculo em andamento', () => {
    for (const sensitivity of ['elevated', 'restricted'] as const) {
      const resource = { authorUserId: 'u2', sensitivity };
      const bare = clinical('view', 'clinical_record', { careRelationship: 'started' }, resource);
      expect(decide(bare, RULES)).toEqual({ allowed: false, reason: 'justification_required' });
      const justified = clinical(
        'view',
        'clinical_record',
        { careRelationship: 'started', justified: true },
        resource,
      );
      expect(decide(justified, RULES).allowed).toBe(true);
      const mine = clinical(
        'view',
        'clinical_record',
        { careRelationship: 'started' },
        {
          authorUserId: 'u1',
          sensitivity,
        },
      );
      expect(decide(mine, RULES).allowed).toBe(true);
    }
  });

  it('só o médico dono da agenda inicia o atendimento', () => {
    const ctx = { careRelationship: 'confirmed' as const };
    const own = clinical('create', 'encounter', ctx, { ownerUserId: 'u1' });
    expect(decide(own, RULES).allowed).toBe(true);
    const other = clinical('create', 'encounter', ctx, { ownerUserId: 'u2' });
    expect(decide(other, RULES)).toEqual({ allowed: false, reason: 'not_own_schedule' });
  });

  it('acesso emergencial libera só leitura, registrada com motivo próprio', () => {
    const ctx = { emergencyAccess: true };
    expect(decide(clinical('view', 'clinical_record', ctx, { authorUserId: 'u2' }), RULES)).toEqual(
      { allowed: true, reason: 'emergency_access' },
    );
    const sensitive = { authorUserId: 'u2', sensitivity: 'restricted' as const };
    expect(decide(clinical('view', 'clinical_record', ctx, sensitive), RULES).allowed).toBe(true);
    expect(decide(clinical('view', 'clinical_summary', ctx), RULES).reason).toBe(
      'emergency_access',
    );
    for (const action of ['create', 'edit', 'sign', 'export', 'share'] as const) {
      expect(decide(clinical(action, 'clinical_record', ctx), RULES).allowed).toBe(false);
    }
    // Com vínculo que já libera a leitura, o motivo continua sendo o papel.
    const both = { emergencyAccess: true, careRelationship: 'started' as const };
    expect(decide(clinical('view', 'clinical_record', both), RULES).reason).toBe('role_doctor');
  });

  it('secretária e administrador continuam sem acesso clínico, inclusive emergencial', () => {
    for (const roles of [['secretary'], ['admin']] as Role[][]) {
      const req = clinical('view', 'clinical_record', {
        careRelationship: 'started',
        emergencyAccess: true,
      });
      req.subject.roles = roles;
      expect(decide(req, RULES)).toEqual({ allowed: false, reason: 'clinical_requires_doctor' });
      const ask = clinical('create', 'clinical_record', {});
      ask.resource.type = 'emergency_access';
      ask.subject.roles = roles;
      expect(decide(ask, RULES).allowed).toBe(false);
    }
  });
});
