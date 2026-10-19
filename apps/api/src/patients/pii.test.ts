import { describe, expect, it } from 'vitest';
import { PiiProtector } from './pii.js';

const key = Buffer.alloc(32, 7).toString('base64');

describe('PiiProtector', () => {
  it('criptografa com valor diferente a cada vez e decifra de volta', () => {
    const pii = new PiiProtector(key);
    const a = pii.encrypt('52998224725');
    const b = pii.encrypt('52998224725');
    expect(a).not.toBe(b);
    expect(a).not.toContain('52998224725');
    expect(pii.decrypt(a)).toBe('52998224725');
  });

  it('o resumo é estável, depende da chave e não é o SHA-256 puro', () => {
    const pii = new PiiProtector(key);
    const other = new PiiProtector(Buffer.alloc(32, 8).toString('base64'));
    expect(pii.lookupHash('52998224725')).toBe(pii.lookupHash('52998224725'));
    expect(pii.lookupHash('52998224725')).not.toBe(other.lookupHash('52998224725'));
    expect(pii.lookupHash('52998224725')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('conteúdo adulterado não decifra', () => {
    const pii = new PiiProtector(key);
    const sealed = pii.encrypt('52998224725');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('00000000000').toString('base64url');
    expect(() => pii.decrypt(parts.join('.'))).toThrow();
  });
});
