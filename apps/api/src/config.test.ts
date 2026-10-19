import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('aplica valores padrão', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://x@localhost/db' });
    expect(config.API_PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
  });

  it('falha com mensagem clara quando falta DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
