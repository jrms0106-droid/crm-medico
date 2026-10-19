import { ROLES } from '@crm/shared';
import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Chave de 32 bytes em base64 para criptografar segredos de MFA. */
    MFA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'MFA_ENCRYPTION_KEY precisa ter 32 bytes em base64 (openssl rand -base64 32)',
    }),
    /** Chave de 32 bytes em base64 para criptografar dados pessoais sensíveis (CPF). */
    PII_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'PII_ENCRYPTION_KEY precisa ter 32 bytes em base64 (openssl rand -base64 32)',
    }),
    MFA_REQUIRED_ROLES: z
      .string()
      .default('doctor,admin')
      .transform((v) =>
        v
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.enum(ROLES))),
    SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
    LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
    LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
    REAUTH_VALID_MINUTES: z.coerce.number().int().positive().default(5),
    COOKIE_SECURE: booleanFromEnv,
    TRUST_PROXY: booleanFromEnv,
  })
  .transform((c) => ({
    ...c,
    // Fora de desenvolvimento/teste o cookie só trafega por HTTPS.
    COOKIE_SECURE: c.COOKIE_SECURE ?? c.NODE_ENV === 'production',
    TRUST_PROXY: c.TRUST_PROXY ?? false,
  }));

export type AppConfig = z.infer<typeof envSchema>;

/** Chaves publicadas no .env.example: servem só para desenvolvimento e testes. */
const PUBLIC_DEV_KEYS = new Set([
  'ZGV2LXNvbWVudGUtbmFvLXVzYXItZW0tcHJvZHVjYW8=',
  'cGlpLWRldi1zb21lbnRlLW5hby11c2FyLWVtLXByb2Q=',
]);

/** Lê e valida as variáveis de ambiente. Falha cedo, com mensagem clara, se faltar algo. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuração inválida:\n${problems.join('\n')}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production') {
    if (!config.COOKIE_SECURE) {
      throw new Error('Configuração inválida: COOKIE_SECURE não pode ser false em produção.');
    }
    if (
      PUBLIC_DEV_KEYS.has(config.MFA_ENCRYPTION_KEY) ||
      PUBLIC_DEV_KEYS.has(config.PII_ENCRYPTION_KEY)
    ) {
      throw new Error('Configuração inválida: chave pública de desenvolvimento usada em produção.');
    }
  }
  if (config.MFA_ENCRYPTION_KEY === config.PII_ENCRYPTION_KEY) {
    throw new Error(
      'Configuração inválida: MFA_ENCRYPTION_KEY e PII_ENCRYPTION_KEY precisam ser diferentes.',
    );
  }
  return config;
}
