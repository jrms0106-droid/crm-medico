import { describe, expect, it } from 'vitest';
import { DEFAULT_DENY, decide } from './engine.js';
import type { AccessRequest, Rule } from './types.js';

const request: AccessRequest = {
  subject: { userId: 'u1', roles: ['admin'], unitIds: ['unit-a'] },
  action: 'view',
  resource: { type: 'clinical_record', dataClass: 'clinical', unitId: 'unit-a', patientId: 'p1' },
};

const allowAll: Rule = () => ({ allowed: true, reason: 'test_allow' });
const denyClinical: Rule = (r) =>
  r.resource.dataClass === 'clinical'
    ? { allowed: false, reason: 'test_deny_clinical' }
    : undefined;
const noOpinion: Rule = () => undefined;

describe('decide', () => {
  it('nega por padrão quando não há regras', () => {
    expect(decide(request, [])).toEqual(DEFAULT_DENY);
  });

  it('nega por padrão quando nenhuma regra opina', () => {
    expect(decide(request, [noOpinion])).toEqual(DEFAULT_DENY);
  });

  it('permite quando uma regra permite e nenhuma nega', () => {
    expect(decide(request, [noOpinion, allowAll])).toEqual({ allowed: true, reason: 'test_allow' });
  });

  it('negação explícita vence permissão, em qualquer ordem', () => {
    expect(decide(request, [allowAll, denyClinical]).allowed).toBe(false);
    expect(decide(request, [denyClinical, allowAll]).allowed).toBe(false);
  });

  it('erro dentro de uma regra resulta em negação', () => {
    const broken: Rule = () => {
      throw new Error('falha');
    };
    expect(decide(request, [allowAll, broken])).toEqual({ allowed: false, reason: 'rule_error' });
  });
});
