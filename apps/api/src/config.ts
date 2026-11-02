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
      .default('doctor,admin,secretary')
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
    // Prazos do vínculo assistencial (docs/api/atendimento-e-vinculo.md), pendentes de validação médica.
    CARE_COURTESY_DAYS: z.coerce.number().int().min(0).max(365).default(30),
    EMERGENCY_ACCESS_HOURS: z.coerce.number().int().min(1).max(24).default(4),
    // Lembretes (docs/api/crm-e-lembretes.md). 0 desliga a rotina; o envio é sempre simulado.
    REMINDERS_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3600).default(0),
    COOKIE_SECURE: booleanFromEnv,
    /**
     * Quantos proxies reversos ficam na frente da API. O IP do cliente é o que o último proxy
     * de confiança viu; um `X-Forwarded-For` montado pelo próprio cliente é ignorado. `true`
     * vale 1 (um proxy), `false` vale 0.
     */
    TRUST_PROXY: z
      .string()
      .regex(
        /^(true|false|[0-5])$/,
        'TRUST_PROXY aceita true, false ou o número de proxies (0 a 5)',
      )
      .transform((v) => (v === 'true' ? 1 : v === 'false' ? 0 : Number(v)))
      .optional(),
  })
  .transform((c) => ({
    ...c,
    // Fora de desenvolvimento/teste o cookie só trafega por HTTPS.
    COOKIE_SECURE: c.COOKIE_SECURE ?? c.NODE_ENV === 'production',
    TRUST_PROXY: c.TRUST_PROXY ?? 0,
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
