import 'dotenv/config';
import { errorResponseSchema } from '@crm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  type TestApp,
  type TestUser,
  createUnit,
  createUser,
  resetData,
  startTestApp,
} from './helpers.js';

let t: TestApp;

// Segunda-feira, 2 de março de 2026, 09:00 em São Paulo (UTC-3).
const NOW = '2026-03-02T12:00:00.000Z';
const DAY = 24 * 3_600_000;

beforeAll(async () => {
  t = await startTestApp({ SESSION_IDLE_MINUTES: '1000000', SESSION_ABSOLUTE_HOURS: '100000' });
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await resetData(t.db);
  t.clock.set(NOW);
});

const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;

let keyCounter = 0;
const newKey = () => `chave-teste-${Date.now()}-${++keyCounter}`;

interface Clinic {
  unitId: string;
  otherUnitId: string;
  patientId: string;
  admin: TestUser;
  as: {
    admin: Client;
    doctor: Client;
    secretary: Client;
    otherSecretary: Client;
  };
}

async function setupClinic(): Promise<Clinic> {
  const org = await t.db.organization.create({ data: { name: 'Clínica Fictícia' } });
  const unit = await createUnit(t.db, org.id, 'Unidade Centro');
  const otherUnit = await createUnit(t.db, org.id, 'Unidade Norte');
  const admin = await createUser(t.db, ['admin'], { organizationId: org.id });
  const doctor = await createUser(t.db, ['doctor'], { organizationId: org.id, unitIds: [unit.id] });
  const secretary = await createUser(t.db, ['secretary'], {
    organizationId: org.id,
    unitIds: [unit.id],
  });
  const otherSecretary = await createUser(t.db, ['secretary'], {
    organizationId: org.id,
    unitIds: [otherUnit.id],
  });
  const login = async (user: TestUser) => {
    const client = new Client(t.app);
    await client.loginFully(user, t.clock);
    return client;
  };
  const as = {
    admin: await login(admin),
    doctor: await login(doctor),
    secretary: await login(secretary),
    otherSecretary: await login(otherSecretary),
  };
  const patient = await as.secretary.post('/patients', {
    fullName: 'Paciente Fictícia',
    birthDate: '1980-05-20',
    phones: [{ number: '(11) 98765-4321' }],
  });
  if (patient.status !== 201) throw new Error(`Falha ao cadastrar paciente: ${patient.status}`);
  return { unitId: unit.id, otherUnitId: otherUnit.id, patientId: patient.body.id, admin, as };
}

async function charge(c: Clinic, extra: object = {}) {
  const res = await c.as.secretary.post('/charges', {
    patientId: c.patientId,
    unitId: c.unitId,
    description: 'Consulta particular',
    amountCents: 30000,
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body;
}

function pay(client: Client, chargeId: string, body: object, key = newKey()) {
  return client.post(`/charges/${chargeId}/payments`, body).set('idempotency-key', key);
}

describe('tabela de preços', () => {
  it('o administrador cria e edita; a secretária só vê; o médico não vê', async () => {
    const c = await setupClinic();
    const created = await c.as.admin.post('/billing/prices', {
      name: 'Consulta',
      amountCents: 25000,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Consulta', amountCents: 25000, active: true });
    const dup = await c.as.admin.post('/billing/prices', { name: 'Consulta', amountCents: 1 });
    expect(dup.status).toBe(409);
    const edited = await c.as.admin.patch(`/billing/prices/${created.body.id}`, { active: false });
    expect(edited.body.active).toBe(false);

    expect((await c.as.secretary.get('/billing/prices')).body).toEqual([]);
    const all = await c.as.secretary.get('/billing/prices?includeInactive=true');
    expect(all.body).toHaveLength(1);
    expect(
      (await c.as.secretary.post('/billing/prices', { name: 'X', amountCents: 1 })).status,
    ).toBe(403);
    expect(
      (await c.as.secretary.patch(`/billing/prices/${created.body.id}`, { active: true })).status,
    ).toBe(403);
    expect((await c.as.doctor.get('/billing/prices')).status).toBe(403);
    const invalid = await c.as.admin.post('/billing/prices', { name: 'Grátis', amountCents: 0 });
    expect(invalid.status).toBe(400);
  });
});

describe('cobranças', () => {
  it('a secretária cobra pela tabela de preços, com desconto', async () => {
    const c = await setupClinic();
    const item = await c.as.admin.post('/billing/prices', { name: 'Consulta', amountCents: 25000 });
    const res = await c.as.secretary.post('/charges', {
      patientId: c.patientId,
      unitId: c.unitId,
      priceItemId: item.body.id,
      discountCents: 5000,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      description: 'Consulta',
      amountCents: 25000,
      discountCents: 5000,
      netCents: 20000,
      paidCents: 0,
      balanceCents: 20000,
      status: 'open',
      patient: { id: c.patientId, name: 'Paciente Fictícia' },
    });
    // Mudar o preço depois não muda a cobrança.
    await c.as.admin.patch(`/billing/prices/${item.body.id}`, { amountCents: 99900 });
    expect((await c.as.secretary.get(`/charges/${res.body.id}`)).body.amountCents).toBe(25000);
    const tooMuch = await c.as.secretary.post('/charges', {
      patientId: c.patientId,
      unitId: c.unitId,
      description: 'Consulta',
      amountCents: 1000,
      discountCents: 2000,
    });
    expect(tooMuch.status).toBe(422);
    const empty = await c.as.secretary.post('/charges', {
      patientId: c.patientId,
      unitId: c.unitId,
    });
    expect(empty.status).toBe(400);
  });

  it('médico, administrador e secretária de outra unidade não criam cobrança', async () => {
    const c = await setupClinic();
    const body = {
      patientId: c.patientId,
      unitId: c.unitId,
      description: 'Consulta',
      amountCents: 1000,
    };
    for (const client of [c.as.doctor, c.as.admin, c.as.otherSecretary]) {
      expect((await client.post('/charges', body)).status).toBe(403);
    }
    const created = await charge(c);
    expect((await c.as.otherSecretary.get(`/charges/${created.id}`)).status).toBe(403);
    expect((await c.as.otherSecretary.get(`/charges?unitId=${c.unitId}`)).status).toBe(403);
    expect((await c.as.doctor.get(`/charges/${created.id}`)).status).toBe(403);
    // O administrador vê, mas não registra pagamento nem cancela.
    expect((await c.as.admin.get(`/charges/${created.id}`)).status).toBe(200);
    expect((await c.as.admin.get(`/charges?unitId=${c.unitId}`)).status).toBe(200);
    expect((await pay(c.as.admin, created.id, { method: 'pix', amountCents: 100 })).status).toBe(
      403,
    );
    expect(
      (await c.as.admin.post(`/charges/${created.id}/cancel`, { reason: 'Teste' })).status,
    ).toBe(403);
    const denied = await t.db.auditEvent.count({
      where: { resourceType: 'charge', outcome: 'denied' },
    });
    expect(denied).toBeGreaterThanOrEqual(8);
    const missing = '00000000-0000-7000-8000-000000000000';
    expect((await c.as.secretary.get(`/charges/${missing}`)).status).toBe(404);
  });

  it('liga a cobrança à consulta, uma por consulta, da mesma unidade e paciente', async () => {
    const c = await setupClinic();
    const doctorUser = await t.db.user.findFirstOrThrow({ where: { roles: { has: 'doctor' } } });
    const professional = await t.db.professional.create({
      data: {
        organizationId: doctorUser.organizationId,
        userId: doctorUser.id,
        crmNumber: '1',
        crmState: 'SP',
      },
    });
    const schedule = await t.db.schedule.create({
      data: {
        organizationId: doctorUser.organizationId,
        unitId: c.unitId,
        professionalId: professional.id,
      },
    });
    await t.db.scheduleRule.create({
      data: { scheduleId: schedule.id, weekday: 2, startMinute: 480, endMinute: 1080 },
    });
    const booked = await c.as.secretary.post('/appointments', {
      scheduleId: schedule.id,
      patientId: c.patientId,
      startsAt: '2026-03-03T09:00:00-03:00',
    });
    expect(booked.status).toBe(201);
    const first = await charge(c, { appointmentId: booked.body.id });
    expect(first.appointmentId).toBe(booked.body.id);
    const second = await c.as.secretary.post('/charges', {
      patientId: c.patientId,
      unitId: c.unitId,
      appointmentId: booked.body.id,
      description: 'De novo',
      amountCents: 100,
    });
    expect(second.status).toBe(409);
    await c.as.secretary.post(`/charges/${first.id}/cancel`, { reason: 'Valor errado' });
    expect((await charge(c, { appointmentId: booked.body.id })).status).toBe('open');
  });

  it('cancela sem pagamento; com pagamento, só depois do estorno', async () => {
    const c = await setupClinic();
    const free = await charge(c);
    const short = await c.as.secretary.post(`/charges/${free.id}/cancel`, { reason: 'x' });
    expect(short.status).toBe(400);
    const cancelled = await c.as.secretary.post(`/charges/${free.id}/cancel`, {
      reason: 'Paciente desistiu',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Paciente desistiu',
    });
    expect(
      (await c.as.secretary.post(`/charges/${free.id}/cancel`, { reason: 'De novo' })).status,
    ).toBe(409);
    expect((await pay(c.as.secretary, free.id, { method: 'cash', amountCents: 100 })).status).toBe(
      409,
    );

    const paid = await charge(c);
    await pay(c.as.secretary, paid.id, { method: 'cash', amountCents: 10000 });
    const blocked = await c.as.secretary.post(`/charges/${paid.id}/cancel`, { reason: 'Erro' });
    expect(blocked.status).toBe(409);
  });
});

describe('pagamentos', () => {
  it('pagamento em partes até quitar; não passa do saldo', async () => {
    const c = await setupClinic();
    const ch = await charge(c);
    const first = await pay(c.as.secretary, ch.id, { method: 'pix', amountCents: 10000 });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      status: 'partially_paid',
      paidCents: 10000,
      balanceCents: 20000,
    });
    const over = await pay(c.as.secretary, ch.id, { method: 'cash', amountCents: 20001 });
    expect(over.status).toBe(422);
    expect(errorCode(over.body)).toBe('AMOUNT_EXCEEDS_BALANCE');
    const rest = await pay(c.as.secretary, ch.id, { method: 'credit_card', amountCents: 20000 });
    expect(rest.body).toMatchObject({ status: 'paid', balanceCents: 0 });
    expect(rest.body.payments).toHaveLength(2);
  });

  it('exige a chave de idempotência e não registra o mesmo pagamento duas vezes', async () => {
    const c = await setupClinic();
    const ch = await charge(c);
    const noKey = await c.as.secretary.post(`/charges/${ch.id}/payments`, {
      method: 'pix',
      amountCents: 100,
    });
    expect(noKey.status).toBe(400);
    expect(errorCode(noKey.body)).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const key = newKey();
    const body = { method: 'pix', amountCents: 5000 };
    const once = await pay(c.as.secretary, ch.id, body, key);
    const twice = await pay(c.as.secretary, ch.id, body, key);
    expect(once.status).toBe(201);
    expect(twice.status).toBe(201);
    expect(twice.body.payments).toHaveLength(1);
    expect(twice.body.paidCents).toBe(5000);
    const different = await pay(c.as.secretary, ch.id, { method: 'pix', amountCents: 6000 }, key);
    expect(different.status).toBe(409);
    expect(errorCode(different.body)).toBe('IDEMPOTENCY_CONFLICT');
    expect(await t.db.payment.count()).toBe(1);
  });

  it('dois pagamentos simultâneos não passam do saldo', async () => {
    const c = await setupClinic();
    const ch = await charge(c);
    const results = await Promise.all([
      pay(c.as.secretary, ch.id, { method: 'pix', amountCents: 20000 }),
      pay(c.as.secretary, ch.id, { method: 'cash', amountCents: 20000 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect((await c.as.secretary.get(`/charges/${ch.id}`)).body.paidCents).toBe(20000);
  });

  it('confere a data do recebimento', async () => {
    const c = await setupClinic();
    const ch = await charge(c);
    const future = await pay(c.as.secretary, ch.id, {
      method: 'cash',
      amountCents: 100,
      paidAt: new Date(Date.parse(NOW) + 3_600_000).toISOString(),
    });
    expect(future.status).toBe(422);
    const old = await pay(c.as.secretary, ch.id, {
      method: 'cash',
      amountCents: 100,
      paidAt: new Date(Date.parse(NOW) - 31 * DAY).toISOString(),
    });
    expect(old.status).toBe(422);
    const yesterday = await pay(c.as.secretary, ch.id, {
      method: 'cash',
      amountCents: 100,
      paidAt: new Date(Date.parse(NOW) - DAY).toISOString(),
    });
    expect(yesterday.status).toBe(201);
    expect(yesterday.body.payments[0].paidAt).toBe('2026-03-01T12:00:00.000Z');
  });

  it('só o administrador estorna, com reautenticação, uma vez', async () => {
    const c = await setupClinic();
    const ch = await charge(c);
    const paid = await pay(c.as.secretary, ch.id, { method: 'pix', amountCents: 30000 });
    const paymentId = paid.body.payments[0].id;
    const path = `/payments/${paymentId}/reverse`;
    expect((await c.as.secretary.post(path, { reason: 'Pix devolvido' })).status).toBe(403);
    expect((await c.as.doctor.post(path, { reason: 'Pix devolvido' })).status).toBe(403);
    t.clock.advance(20 * 60_000);
    const noReauth = await c.as.admin.post(path, { reason: 'Pix devolvido' });
    expect(noReauth.status).toBe(403);
    expect(errorCode(noReauth.body)).toBe('REAUTH_REQUIRED');
    await c.as.admin.reauth(c.admin, t.clock);
    const reversed = await c.as.admin.post(path, { reason: 'Pix devolvido' });
    expect(reversed.status).toBe(200);
    expect(reversed.body).toMatchObject({ status: 'open', paidCents: 0, balanceCents: 30000 });
    expect(reversed.body.payments[0]).toMatchObject({ reverseReason: 'Pix devolvido' });
    expect((await c.as.admin.post(path, { reason: 'De novo' })).status).toBe(409);
    // Depois do estorno, a cobrança pode ser cancelada.
    expect(
      (await c.as.secretary.post(`/charges/${ch.id}/cancel`, { reason: 'Estornado' })).status,
    ).toBe(200);
  });

  it('o banco recusa alterar ou apagar valores e pagamentos', async () => {
    const c = await setupClinic();
    const ch = await charge(c);
    const paid = await pay(c.as.secretary, ch.id, { method: 'pix', amountCents: 100 });
    const paymentId = paid.body.payments[0].id;
    await expect(
      t.db.$executeRaw`UPDATE billing.charges SET amount_cents = 1 WHERE id = ${ch.id}::uuid`,
    ).rejects.toThrow(/não podem ser alterados/);
    await expect(
      t.db.$executeRaw`DELETE FROM billing.charges WHERE id = ${ch.id}::uuid`,
    ).rejects.toThrow(/apagada/);
    await expect(
      t.db.$executeRaw`UPDATE billing.payments SET amount_cents = 1 WHERE id = ${paymentId}::uuid`,
    ).rejects.toThrow(/estorno/);
    await expect(
      t.db.$executeRaw`DELETE FROM billing.payments WHERE id = ${paymentId}::uuid`,
    ).rejects.toThrow(/apagado/);
  });
});

describe('lista e relatório', () => {
  it('lista por unidade e situação', async () => {
    const c = await setupClinic();
    const a = await charge(c);
    const b = await charge(c);
    await pay(c.as.secretary, b.id, { method: 'cash', amountCents: 30000 });
    const open = await c.as.secretary.get(`/charges?unitId=${c.unitId}&status=open`);
    expect(open.body.map((x: { id: string }) => x.id)).toEqual([a.id]);
    const all = await c.as.secretary.get(`/charges?unitId=${c.unitId}`);
    expect(all.body).toHaveLength(2);
    expect((await c.as.secretary.get('/charges')).status).toBe(400);
  });

  it('resume o período por forma de pagamento, com estornos e saldo em aberto', async () => {
    const c = await setupClinic();
    const a = await charge(c, { discountCents: 5000 });
    const b = await charge(c);
    const cancelled = await charge(c);
    await c.as.secretary.post(`/charges/${cancelled.id}/cancel`, { reason: 'Desistiu' });
    await pay(c.as.secretary, a.id, { method: 'pix', amountCents: 25000 });
    const partial = await pay(c.as.secretary, b.id, { method: 'cash', amountCents: 10000 });
    await pay(c.as.secretary, b.id, { method: 'debit_card', amountCents: 5000 });
    await c.as.admin.reauth(c.admin, t.clock);
    await c.as.admin.post(`/payments/${partial.body.payments[0].id}/reverse`, { reason: 'Erro' });

    const q = `from=2026-03-02&to=2026-03-02&unitId=${c.unitId}`;
    const res = await c.as.secretary.get(`/billing/report?${q}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      charged: { count: 2, grossCents: 60000, discountCents: 5000, netCents: 55000 },
      received: {
        totalCents: 30000,
        byMethod: { pix: 25000, cash: 0, debit_card: 5000, credit_card: 0, other: 0 },
      },
      reversedCents: 10000,
      openCents: 25000,
      openCount: 1,
    });
    // Admin sem unidade: a organização toda. Secretária de outra unidade: nega.
    const org = await c.as.admin.get('/billing/report?from=2026-03-02&to=2026-03-02');
    expect(org.body.received.totalCents).toBe(30000);
    expect((await c.as.otherSecretary.get(`/billing/report?${q}`)).status).toBe(403);
    const own = await c.as.otherSecretary.get('/billing/report?from=2026-03-02&to=2026-03-02');
    expect(own.body.received.totalCents).toBe(0);
    expect((await c.as.doctor.get(`/billing/report?${q}`)).status).toBe(403);
    // Outro dia: nada.
    const before = await c.as.secretary.get(
      `/billing/report?from=2026-03-01&to=2026-03-01&unitId=${c.unitId}`,
    );
    expect(before.body.received.totalCents).toBe(0);
    const tooLong = await c.as.admin.get('/billing/report?from=2025-01-01&to=2026-03-02');
    expect(tooLong.status).toBe(422);
  });
});
