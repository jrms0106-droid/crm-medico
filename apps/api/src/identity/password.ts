import argon2 from 'argon2';

// Parâmetros recomendados pela OWASP para Argon2id (19 MiB, 2 iterações, 1 via).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Gasta o mesmo tempo de uma verificação real quando o e-mail não existe,
 * para que o tempo de resposta não revele quais e-mails estão cadastrados.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('senha-inexistente-apenas-para-tempo');
  await verifyPassword(await dummyHash, password);
}

/** Senha temporária legível para ditar ao usuário: 4 grupos de 4 caracteres. */
export function temporaryPassword(random: (n: number) => Buffer): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = random(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}
