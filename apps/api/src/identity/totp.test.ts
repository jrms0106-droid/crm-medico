import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, totpAt, verifyTotp } from './totp.js';

// Segredo e valores de referência do RFC 6238, apêndice B (SHA-1, 8 dígitos → últimos 6).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('reproduz os vetores de teste do RFC 6238', () => {
    expect(totpAt(RFC_SECRET, new Date(59_000))).toBe('287082');
    expect(totpAt(RFC_SECRET, new Date(1_111_111_109_000))).toBe('081804');
    expect(totpAt(RFC_SECRET, new Date(1_234_567_890_000))).toBe('005924');
    expect(totpAt(RFC_SECRET, new Date(2_000_000_000_000))).toBe('279037');
  });

  it('reproduz os vetores de teste do HOTP (RFC 4226)', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(hotp(secret, 0)).toBe('755224');
    expect(hotp(secret, 9)).toBe('520489');
  });

  it('base32 ida e volta', () => {
    const buf = Buffer.from('qualquer coisa 123');
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
  });

  it('aceita a janela vizinha e recusa código fora dela', () => {
    const now = new Date(1_700_000_000_000);
    const previous = totpAt(RFC_SECRET, new Date(now.getTime() - 30_000));
    const old = totpAt(RFC_SECRET, new Date(now.getTime() - 90_000));
    expect(verifyTotp(RFC_SECRET, previous, now, null)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, old, now, null)).toBeNull();
  });

  it('não aceita o mesmo código duas vezes', () => {
    const now = new Date(1_700_000_000_000);
    const code = totpAt(RFC_SECRET, now);
    const step = verifyTotp(RFC_SECRET, code, now, null);
    expect(step).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
  });

  it('gera URI otpauth para apps autenticadores', () => {
    expect(otpauthUri('ABC', 'ana@exemplo.com', 'CRM Médico')).toMatch(
      /^otpauth:\/\/totp\/CRM%20M%C3%A9dico%3Aana%40exemplo\.com\?secret=ABC&issuer=/,
    );
  });
});
