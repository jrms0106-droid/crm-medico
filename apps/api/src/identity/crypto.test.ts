import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './crypto.js';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32).toString('base64'));

  it('criptografa e decifra', () => {
    const sealed = box.encrypt('segredo');
    expect(sealed).not.toContain('segredo');
    expect(box.decrypt(sealed)).toBe('segredo');
  });

  it('detecta adulteração', () => {
    const sealed = box.encrypt('segredo');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('outra coisa').toString('base64url');
    expect(() => box.decrypt(parts.join('.'))).toThrow();
  });

  it('recusa decifrar com outra chave', () => {
    const other = new SecretBox(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(box.encrypt('segredo'))).toThrow();
  });
});
