import { describe, expect, it } from 'vitest';
import { loginRequestSchema, passwordProblem } from './auth.js';

describe('passwordProblem', () => {
  it('aceita senha forte', () => {
    expect(passwordProblem('cavalo-bateria-grampo', 'ana@exemplo.com')).toBeNull();
  });

  it('recusa senha curta, repetida ou com o e-mail', () => {
    expect(passwordProblem('curta')).toMatch(/12/);
    expect(passwordProblem('aaaaaaaaaaaaaaaa')).toMatch(/repetido/);
    expect(passwordProblem('ana.silva-2026-segura', 'ana.silva@exemplo.com')).toMatch(/e-mail/);
  });
});

describe('loginRequestSchema', () => {
  it('normaliza o e-mail e recusa campos extras', () => {
    expect(loginRequestSchema.parse({ email: ' Ana@Exemplo.COM ', password: 'x' }).email).toBe(
      'ana@exemplo.com',
    );
    expect(() =>
      loginRequestSchema.parse({ email: 'a@b.com', password: 'x', admin: true }),
    ).toThrow();
  });
});
