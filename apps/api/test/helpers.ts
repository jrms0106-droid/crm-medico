import type { INestApplication } from '@nestjs/common';
import type { RoleName } from '@crm/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Clock } from '../src/common/clock.js';
import { loadConfig } from '../src/config.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { hashPassword } from '../src/identity/password.js';
import { totpAt } from '../src/identity/totp.js';

/** Chave pública de teste (mesma do .env.example). Nunca usar fora de testes. */
const TEST_MFA_KEY = 'ZGV2LXNvbWVudGUtbmFvLXVzYXItZW0tcHJvZHVjYW8=';

/** Relógio controlado pelos testes. */
export class TestClock extends Clock {
  private current = new Date('2026-03-02T12:00:00.000Z');
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const MINUTE = 60_000;

export interface TestApp {
  app: INestApplication;
  clock: TestClock;
  db: PrismaClient;
  close(): Promise<void>;
}

export async function startTestApp(env: Record<string, string> = {}): Promise<TestApp> {
  const url = process.env['DATABASE_URL_TEST'];
  const config = loadConfig({
    MFA_ENCRYPTION_KEY: TEST_MFA_KEY,
    LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
    ...process.env,
    DATABASE_URL: url,
    NODE_ENV: 'test',
    COOKIE_SECURE: 'false',
    ...env,
  });
  const clock = new TestClock();
  const app = await createApp(config, { clock });
  await app.init();
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url ?? '' }) });
  return {
    app,
    clock,
    db,
    async close() {
      await app.close();
      await db.$disconnect();
    },
  };
}

/** Apaga os dados entre testes (ordem respeita as chaves estrangeiras). */
export async function resetData(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE identity.sessions, identity.users, org.units, org.organizations CASCADE',
  );
}

export const STRONG_PASSWORD = 'senha-ficticia-forte-2026';

export interface TestUser {
  id: string;
  email: string;
  password: string;
  organizationId: string;
}

let counter = 0;

export async function createUser(
  db: PrismaClient,
  roles: RoleName[],
  extra: { organizationId?: string; mustChangePassword?: boolean } = {},
): Promise<TestUser> {
  counter += 1;
  const organizationId =
    extra.organizationId ??
    (await db.organization.create({ data: { name: `Clínica Teste ${counter}` } })).id;
  const email = `usuario${counter}@clinica-ficticia.test`;
  const user = await db.user.create({
    data: {
      organizationId,
      name: `Usuário Fictício ${counter}`,
      email,
      passwordHash: await hashPassword(STRONG_PASSWORD),
      roles,
      mustChangePassword: extra.mustChangePassword ?? false,
    },
  });
  return { id: user.id, email, password: STRONG_PASSWORD, organizationId };
}

export type Agent = ReturnType<typeof request.agent>;

/** Cliente HTTP que guarda o cookie de sessão e envia o token CSRF automaticamente. */
export class Client {
  readonly agent: Agent;
  csrf = '';

  constructor(app: INestApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  get(path: string) {
    return this.agent.get(`/api/v1${path}`);
  }

  post(path: string, body?: object) {
    const req = this.agent.post(`/api/v1${path}`).set('x-csrf-token', this.csrf);
    return body ? req.send(body) : req;
  }

  async login(email: string, password: string) {
    const res = await this.agent.post('/api/v1/auth/login').send({ email, password });
    if (res.status === 200) this.csrf = res.body.csrfToken;
    return res;
  }

  /** Login completo: senha + cadastro do MFA quando exigido. Devolve o segredo TOTP, se houver. */
  async loginFully(user: TestUser, clock: TestClock): Promise<string | undefined> {
    const res = await this.login(user.email, user.password);
    if (res.body.state !== 'pending_mfa') return undefined;
    const setup = await this.post('/auth/mfa/setup');
    const secret: string = setup.body.secret;
    const activated = await this.post('/auth/mfa/activate', { code: totpAt(secret, clock.now()) });
    if (activated.status !== 200) throw new Error(`Falha ao ativar MFA: ${activated.status}`);
    return secret;
  }
}
