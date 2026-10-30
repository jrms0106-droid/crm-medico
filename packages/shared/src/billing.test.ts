import { describe, expect, it } from 'vitest';
import { formatCents, parseReais } from './billing.js';

describe('valores em reais', () => {
  it('converte o que a recepção digita em centavos', () => {
    expect(parseReais('150')).toBe(15000);
    expect(parseReais('150,5')).toBe(15050);
    expect(parseReais('150,05')).toBe(15005);
    expect(parseReais('1.234,56')).toBe(123456);
    expect(parseReais('R$ 80,00')).toBe(8000);
    expect(parseReais(' 0,01 ')).toBe(1);
  });

  it('recusa valores ambíguos ou inválidos', () => {
    for (const bad of ['', 'abc', '10,123', '1.23', '12.34,00', '-5', '10.50']) {
      expect(parseReais(bad), bad).toBeNull();
    }
  });

  it('formata centavos em reais', () => {
    expect(formatCents(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
  });
});
