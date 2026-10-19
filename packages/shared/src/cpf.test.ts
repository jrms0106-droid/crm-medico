import { describe, expect, it } from 'vitest';
import { formatCpf, isValidCpf, normalizeCpf } from './cpf.js';

// CPFs fictícios gerados apenas para teste (dígitos verificadores válidos).
describe('isValidCpf', () => {
  it('aceita CPF válido com ou sem pontuação', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });

  it('recusa dígito verificador errado', () => {
    expect(isValidCpf('529.982.247-24')).toBe(false);
  });

  it('recusa sequências repetidas e tamanhos errados', () => {
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('1234567890')).toBe(false);
    expect(isValidCpf('')).toBe(false);
  });
});

describe('formatação', () => {
  it('normaliza e formata', () => {
    expect(normalizeCpf(' 529.982.247-25 ')).toBe('52998224725');
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
  });
});
