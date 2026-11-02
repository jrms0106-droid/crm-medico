import { createHmac } from 'node:crypto';
import { e2eNow } from './clock.js';

/** TOTP (RFC 6238) para os testes: mesmo algoritmo dos aplicativos autenticadores. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Passo de 30 s no relógio dos testes, o mesmo que a API usa (e2e/clock.ts). */
export const currentStep = () => Math.floor(e2eNow().getTime() / 30_000);

/** Código de um passo de 30 s. O servidor aceita o passo atual e os vizinhos, sem repetição. */
export function totpAt(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', decode(secret)).update(msg).digest();
  const at = (hmac[hmac.length - 1] ?? 0) & 0xf;
  return String((hmac.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
