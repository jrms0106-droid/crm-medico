import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('aplica valores padrão', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgresql://x@localhost/db',
      MFA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      PII_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });
    expect(config.API_PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.MFA_REQUIRED_ROLES).toEqual(['doctor', 'admin']);
    expect(config.COOKIE_SECURE).toBe(false);
  });

  it('em produção exige cookie seguro e chave de MFA válida', () => {
    const base = {
      DATABASE_URL: 'postgresql://x@localhost/db',
      NODE_ENV: 'production',
      PII_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(() => loadConfig({ ...base, MFA_ENCRYPTION_KEY: 'curta' })).toThrow(/32 bytes/);
    const key = Buffer.alloc(32).toString('base64');
    expect(loadConfig({ ...base, MFA_ENCRYPTION_KEY: key }).COOKIE_SECURE).toBe(true);
    expect(() => loadConfig({ ...base, MFA_ENCRYPTION_KEY: key, COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
  });

  it('em produção recusa as chaves públicas de desenvolvimento e chaves repetidas', () => {
    const base = { DATABASE_URL: 'postgresql://x@localhost/db', NODE_ENV: 'production' };
    const key = Buffer.alloc(32).toString('base64');
    const devPii = 'cGlpLWRldi1zb21lbnRlLW5hby11c2FyLWVtLXByb2Q=';
    expect(() =>
      loadConfig({ ...base, MFA_ENCRYPTION_KEY: key, PII_ENCRYPTION_KEY: devPii }),
    ).toThrow(/desenvolvimento/);
    expect(() => loadConfig({ ...base, MFA_ENCRYPTION_KEY: key, PII_ENCRYPTION_KEY: key })).toThrow(
      /diferentes/,
    );
  });

  it('falha com mensagem clara quando falta DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
