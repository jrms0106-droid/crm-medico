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
const TEST_PII_KEY = 'cGlpLWRldi1zb21lbnRlLW5hby11c2FyLWVtLXByb2Q=';

/** Relógio controlado pelos testes. */
export class TestClock extends Clock {
  private current = new Date('2026-03-02T12:00:00.000Z');
  now(): Date {
    return new Date(this.current);
  }
  set(date: Date | string): void {
    this.current = new Date(date);
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
    PII_ENCRYPTION_KEY: TEST_PII_KEY,
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
    `TRUNCATE privacy.subject_requests, billing.payments, billing.charges, billing.price_items, documents.document_events, documents.medical_documents, records.access_justifications, records.record_events, records.record_versions, records.clinical_records,
      care.emergency_accesses, care.encounters, scheduling.appointment_events, scheduling.waitlist_entries, scheduling.appointments, scheduling.schedule_blocks, scheduling.schedule_rules, scheduling.schedules,
      patients.versions, patients.contacts, patients.phones, patients.patients, audit.events, org.professional_specialties, org.professionals, org.specialties,
      org.unit_memberships, identity.sessions, identity.users, org.units, org.organizations CASCADE`,
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

export async function createUnit(db: PrismaClient, organizationId: string, name?: string) {
  counter += 1;
  return db.unit.create({ data: { organizationId, name: name ?? `Unidade Fictícia ${counter}` } });
}

export async function createUser(
  db: PrismaClient,
  roles: RoleName[],
  extra: { organizationId?: string; mustChangePassword?: boolean; unitIds?: string[] } = {},
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
      unitMemberships: { create: (extra.unitIds ?? []).map((unitId) => ({ unitId })) },
    },
  });
  return { id: user.id, email, password: STRONG_PASSWORD, organizationId };
}

export type Agent = ReturnType<typeof request.agent>;

/** Cliente HTTP que guarda o cookie de sessão e envia o token CSRF automaticamente. */
export class Client {
  readonly agent: Agent;
  csrf = '';
  /** Segredo TOTP cadastrado no login completo, se houver. */
  mfaSecret: string | undefined;

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

  patch(path: string, body: object) {
    return this.agent.patch(`/api/v1${path}`).set('x-csrf-token', this.csrf).send(body);
  }

  /**
   * Reautentica para ações críticas. Avança o relógio uma janela TOTP, porque o código do
   * login não pode ser reutilizado.
   */
  async reauth(user: TestUser, clock: TestClock): Promise<void> {
    clock.advance(30_000);
    const code = this.mfaSecret ? totpAt(this.mfaSecret, clock.now()) : undefined;
    const res = await this.post('/auth/reauth', { password: user.password, code });
    if (res.status !== 204) throw new Error(`Falha na reautenticação: ${res.status}`);
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
    this.mfaSecret = secret;
    return secret;
  }
}
