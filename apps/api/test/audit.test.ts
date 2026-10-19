import 'dotenv/config';
import type { AuditChainReportDto } from '@crm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  type TestApp,
  createUnit,
  createUser,
  resetData,
  startTestApp,
} from './helpers.js';

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await resetData(t.db);
});

async function setupOrg() {
  const org = await t.db.organization.create({ data: { name: 'Clínica Fictícia' } });
  const unit = await createUnit(t.db, org.id);
  const base = { organizationId: org.id, unitIds: [unit.id] };
  const users = {
    admin: await createUser(t.db, ['admin'], base),
    doctor: await createUser(t.db, ['doctor'], base),
    secretary: await createUser(t.db, ['secretary'], base),
  };
  const login = async (user: (typeof users)['admin']) => {
    const client = new Client(t.app);
    await client.loginFully(user, t.clock);
    return client;
  };
  return {
    organizationId: org.id,
    as: {
      admin: await login(users.admin),
      doctor: await login(users.doctor),
      secretary: await login(users.secretary),
    },
  };
}

type Org = Awaited<ReturnType<typeof setupOrg>>;

/** Gera alguns eventos permitidos e negados. */
async function someActivity(o: Org) {
  await o.as.secretary.get('/patients?q=ficticia');
  await o.as.secretary.get('/admin/users');
  await o.as.doctor.get('/audit/events');
  await o.as.admin.get('/admin/users');
}

async function verify(o: Org): Promise<AuditChainReportDto> {
  const res = await o.as.admin.get('/audit/verify');
  expect(res.status).toBe(200);
  return res.body;
}

/** Simula quem controla o banco: desliga a proteção somente-acréscimo e mexe na trilha. */
async function tamper(sql: string) {
  await t.db.$transaction([
    t.db.$executeRawUnsafe('ALTER TABLE audit.events DISABLE TRIGGER events_append_only'),
    t.db.$executeRawUnsafe(sql),
    t.db.$executeRawUnsafe('ALTER TABLE audit.events ENABLE TRIGGER events_append_only'),
  ]);
}

async function eventAt(organizationId: string, chainSeq: number) {
  return t.db.auditEvent.findFirstOrThrow({
    where: { organizationId, chainSeq: BigInt(chainSeq) },
  });
}

describe('cadeia de auditoria', () => {
  it('cada evento entra no fim da cadeia da organização, ligado ao anterior', async () => {
    const o = await setupOrg();
    await someActivity(o);
    const events = await t.db.auditEvent.findMany({
      where: { organizationId: o.organizationId },
      orderBy: { chainSeq: 'asc' },
    });
    expect(events.length).toBeGreaterThanOrEqual(4);
    events.forEach((e, i) => {
      expect(Number(e.chainSeq)).toBe(i + 1);
      expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(e.prevHash).toBe(i === 0 ? null : events[i - 1]?.hash);
    });
    const report = await verify(o);
    expect(report).toMatchObject({ valid: true, problems: [] });
    // A própria verificação foi auditada antes de percorrer a cadeia.
    expect(report.checked).toBe(events.length + 1);
    expect(report.headSeq).toBe(events.length + 1);
  });

  it('só o administrador verifica a cadeia', async () => {
    const o = await setupOrg();
    expect((await o.as.doctor.get('/audit/verify')).status).toBe(403);
    expect((await o.as.secretary.get('/audit/verify')).status).toBe(403);
    const denied = await t.db.auditEvent.count({
      where: { organizationId: o.organizationId, resourceType: 'audit_event', outcome: 'denied' },
    });
    expect(denied).toBe(2);
  });

  it('um campo alterado é detectado no próprio evento', async () => {
    const o = await setupOrg();
    await someActivity(o);
    const target = await eventAt(o.organizationId, 3);
    await tamper(
      `UPDATE audit.events SET outcome = 'allowed', reason = 'role_admin' WHERE id = '${target.id}'`,
    );
    const report = await verify(o);
    expect(report.valid).toBe(false);
    expect(report.problems).toEqual([{ chainSeq: 3, eventId: target.id, issue: 'content' }]);
  });

  it('um evento apagado deixa um buraco na cadeia', async () => {
    const o = await setupOrg();
    await someActivity(o);
    const target = await eventAt(o.organizationId, 2);
    const next = await eventAt(o.organizationId, 3);
    await tamper(`DELETE FROM audit.events WHERE id = '${target.id}'`);
    const report = await verify(o);
    expect(report.valid).toBe(false);
    expect(report.problems[0]).toEqual({ chainSeq: 3, eventId: next.id, issue: 'gap' });
  });

  it('recalcular o resumo do evento alterado quebra o elo com o seguinte', async () => {
    const o = await setupOrg();
    await someActivity(o);
    const target = await eventAt(o.organizationId, 2);
    const next = await eventAt(o.organizationId, 3);
    await tamper(
      `UPDATE audit.events SET reason = 'alterado' WHERE id = '${target.id}';` +
        ` UPDATE audit.events e SET hash = audit.event_digest(e) WHERE id = '${target.id}'`,
    );
    const report = await verify(o);
    expect(report.problems).toEqual([{ chainSeq: 3, eventId: next.id, issue: 'link' }]);
  });

  it('pedidos simultâneos não disputam a mesma posição', async () => {
    const o = await setupOrg();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => o.as.secretary.get('/admin/users')),
    );
    expect(results.every((r) => r.status === 403)).toBe(true);
    const report = await verify(o);
    expect(report).toMatchObject({ valid: true, problems: [] });
    const positions = await t.db.auditEvent.findMany({
      where: { organizationId: o.organizationId },
      select: { chainSeq: true },
    });
    expect(new Set(positions.map((p) => p.chainSeq)).size).toBe(positions.length);
  });

  it('cada organização tem a sua cadeia', async () => {
    const a = await setupOrg();
    const b = await setupOrg();
    await someActivity(a);
    await someActivity(b);
    const target = await eventAt(b.organizationId, 2);
    await tamper(`UPDATE audit.events SET reason = 'alterado' WHERE id = '${target.id}'`);
    expect((await verify(a)).valid).toBe(true);
    expect((await verify(b)).valid).toBe(false);
  });
});

describe('painel de auditoria', () => {
  it('filtra por tipo de recurso, ação e período, e mostra a posição na cadeia', async () => {
    const o = await setupOrg();
    const start = t.clock.now().toISOString();
    await someActivity(o);
    const res = await o.as.admin.get(
      `/audit/events?resourceType=user_account&action=view&after=${encodeURIComponent(start)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    for (const e of res.body) {
      expect(e).toMatchObject({ resourceType: 'user_account', action: 'view' });
      expect(e.chainSeq).toBeGreaterThan(0);
    }
    const none = await o.as.admin.get(
      '/audit/events?patientId=0190a000-0000-7000-8000-000000000000',
    );
    expect(none.body).toEqual([]);
  });
});
