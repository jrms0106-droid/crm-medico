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
const MISSING = '01920000-0000-7000-8000-00000000abcd';

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

interface Clinic {
  patientId: string;
  secretary: TestUser;
  as: { admin: Client; doctor: Client; secretary: Client; outsider: Client };
}

async function setupClinic(): Promise<Clinic> {
  const org = await t.db.organization.create({ data: { name: 'Clínica Fictícia' } });
  const unit = await createUnit(t.db, org.id, 'Unidade Centro');
  const admin = await createUser(t.db, ['admin'], { organizationId: org.id });
  const doctor = await createUser(t.db, ['doctor'], { organizationId: org.id, unitIds: [unit.id] });
  const secretary = await createUser(t.db, ['secretary'], {
    organizationId: org.id,
    unitIds: [unit.id],
  });
  // Secretária de outra organização: não pode ver nada desta.
  const otherOrg = await t.db.organization.create({ data: { name: 'Outra Clínica Fictícia' } });
  const otherUnit = await createUnit(t.db, otherOrg.id, 'Unidade Sul');
  const outsider = await createUser(t.db, ['secretary'], {
    organizationId: otherOrg.id,
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
    outsider: await login(outsider),
  };
  const patient = await as.secretary.post('/patients', {
    fullName: 'Paciente Fictícia',
    birthDate: '1980-05-20',
    cpf: '529.982.247-25',
    phones: [{ number: '(11) 98765-4321' }],
  });
  if (patient.status !== 201) throw new Error(`Falha ao cadastrar paciente: ${patient.status}`);
  return { patientId: patient.body.id, secretary, as };
}

describe('pedidos do titular', () => {
  it('a secretária registra com prazo de 15 dias, vê o atraso e responde uma vez só', async () => {
    const c = await setupClinic();
    const created = await c.as.secretary.post('/privacy/requests', {
      patientId: c.patientId,
      kind: 'portability',
      details: 'Pediu cópia dos dados por escrito.',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      patient: { id: c.patientId, name: 'Paciente Fictícia' },
      kind: 'portability',
      status: 'open',
      dueOn: '2026-03-17',
      overdue: false,
    });

    t.clock.advance(16 * DAY);
    const list = await c.as.secretary.get('/privacy/requests?status=open');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].overdue).toBe(true);

    const short = await c.as.secretary.post(`/privacy/requests/${created.body.id}/resolve`, {
      status: 'completed',
      resolution: 'ok',
    });
    expect(short.status).toBe(400);
    const done = await c.as.secretary.post(`/privacy/requests/${created.body.id}/resolve`, {
      status: 'completed',
      resolution: 'Arquivo entregue em mãos ao titular.',
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'completed', overdue: false });
    expect(done.body.resolvedBy).not.toBeNull();

    const again = await c.as.secretary.post(`/privacy/requests/${created.body.id}/resolve`, {
      status: 'denied',
      resolution: 'Mudei de ideia.',
    });
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe('CONFLICT');
  });

  it('o banco não deixa apagar nem mudar pedido respondido', async () => {
    const c = await setupClinic();
    const created = await c.as.secretary.post('/privacy/requests', {
      patientId: c.patientId,
      kind: 'access_report',
    });
    await expect(
      t.db.subjectRequest.update({ where: { id: created.body.id }, data: { kind: 'other' } }),
    ).rejects.toThrow(/não podem ser alterados/);
    await c.as.secretary.post(`/privacy/requests/${created.body.id}/resolve`, {
      status: 'denied',
      resolution: 'Pedido feito por terceiro sem procuração.',
    });
    await expect(
      t.db.subjectRequest.update({
        where: { id: created.body.id },
        data: { resolution: 'Outra resposta.' },
      }),
    ).rejects.toThrow(/já respondido/);
    await expect(t.db.subjectRequest.delete({ where: { id: created.body.id } })).rejects.toThrow(
      /não pode ser apagado/,
    );
  });

  it('médico, administrador e outra organização não acessam os pedidos', async () => {
    const c = await setupClinic();
    const created = await c.as.secretary.post('/privacy/requests', {
      patientId: c.patientId,
      kind: 'access',
    });
    for (const client of [c.as.doctor, c.as.admin]) {
      expect((await client.get('/privacy/requests')).status).toBe(403);
      expect(
        (await client.post('/privacy/requests', { patientId: c.patientId, kind: 'access' })).status,
      ).toBe(403);
      expect(
        (
          await client.post(`/privacy/requests/${created.body.id}/resolve`, {
            status: 'completed',
            resolution: 'Atendido.',
          })
        ).status,
      ).toBe(403);
    }
    // Outra organização: o paciente e o pedido "não existem".
    expect(
      (await c.as.outsider.post('/privacy/requests', { patientId: c.patientId, kind: 'access' }))
        .status,
    ).toBe(404);
    expect(
      (
        await c.as.outsider.post(`/privacy/requests/${created.body.id}/resolve`, {
          status: 'completed',
          resolution: 'Atendido.',
        })
      ).status,
    ).toBe(404);
    expect((await c.as.outsider.get('/privacy/requests')).body).toEqual([]);
    const invalid = await c.as.secretary.post('/privacy/requests', {
      patientId: c.patientId,
      kind: 'qualquer',
    });
    expect(invalid.status).toBe(400);
  });
});

describe('relatório de acessos', () => {
  it('mostra quem acessou os dados do paciente, sem conteúdo clínico', async () => {
    const c = await setupClinic();
    // O médico abre o cadastro; o administrador tenta e é negado.
    expect((await c.as.doctor.get(`/patients/${c.patientId}`)).status).toBe(200);
    expect((await c.as.admin.get(`/patients/${c.patientId}`)).status).toBe(403);

    const report = await c.as.secretary.get(`/patients/${c.patientId}/access-report`);
    expect(report.status).toBe(200);
    expect(report.body.patient).toEqual({ id: c.patientId, name: 'Paciente Fictícia' });
    expect(report.body.truncated).toBe(false);
    const entries = report.body.entries as {
      who: { roles: string[] } | null;
      resourceType: string;
      action: string;
      outcome: string;
    }[];
    expect(entries).toContainEqual(
      expect.objectContaining({
        who: expect.objectContaining({ roles: ['doctor'] }),
        resourceType: 'patient_registration',
        action: 'view',
        outcome: 'allowed',
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        who: expect.objectContaining({ roles: ['admin'] }),
        outcome: 'denied',
      }),
    );
    expect(JSON.stringify(report.body)).not.toMatch(/529\.?982/);

    // Período sem eventos.
    const empty = await c.as.secretary.get(
      `/patients/${c.patientId}/access-report?from=2026-01-01&to=2026-01-31`,
    );
    expect(empty.body.entries).toEqual([]);
    const inverted = await c.as.secretary.get(
      `/patients/${c.patientId}/access-report?from=2026-03-10&to=2026-03-01`,
    );
    expect(inverted.status).toBe(400);
  });

  it('só a secretária gera o relatório', async () => {
    const c = await setupClinic();
    expect((await c.as.doctor.get(`/patients/${c.patientId}/access-report`)).status).toBe(403);
    expect((await c.as.admin.get(`/patients/${c.patientId}/access-report`)).status).toBe(403);
    expect((await c.as.outsider.get(`/patients/${c.patientId}/access-report`)).status).toBe(404);
    expect((await c.as.secretary.get(`/patients/${MISSING}/access-report`)).status).toBe(404);
  });
});

describe('exportação dos dados do paciente', () => {
  it('exige reautenticação e entrega um arquivo JSON com cadastro, consultas, cobranças e pedidos', async () => {
    const c = await setupClinic();
    await c.as.secretary.post('/privacy/requests', { patientId: c.patientId, kind: 'portability' });
    const units = await c.as.secretary.get('/units');
    const charge = await c.as.secretary.post('/charges', {
      patientId: c.patientId,
      unitId: units.body[0].id,
      description: 'Consulta particular',
      amountCents: 30000,
    });
    expect(charge.status).toBe(201);

    const noReauth = await c.as.secretary.get(`/patients/${c.patientId}/export`);
    expect(noReauth.status).toBe(403);
    expect(errorCode(noReauth.body)).toBe('REAUTH_REQUIRED');

    await c.as.secretary.reauth(c.secretary, t.clock);
    const res = await c.as.secretary.get(`/patients/${c.patientId}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="dados-do-paciente-2026-03-02\.json"$/,
    );
    const data = JSON.parse(res.text);
    expect(data).toMatchObject({
      format: 'crm-medico/exportacao-do-titular',
      version: 1,
      organization: { name: 'Clínica Fictícia' },
      patient: { id: c.patientId, fullName: 'Paciente Fictícia', cpf: '529.982.247-25' },
      appointments: [],
      clinical: { included: false },
    });
    expect(data.charges).toHaveLength(1);
    expect(data.charges[0]).toMatchObject({ amountCents: 30000, status: 'open' });
    expect(data.subjectRequests).toHaveLength(1);

    // A exportação fica na auditoria.
    const audit = await t.db.auditEvent.findMany({
      where: { patientId: c.patientId, resourceType: 'patient_rights', action: 'export' },
    });
    expect(audit.map((e) => e.outcome)).toContain('allowed');
  });

  it('médico, administrador e outra organização não exportam', async () => {
    const c = await setupClinic();
    expect((await c.as.doctor.get(`/patients/${c.patientId}/export`)).status).toBe(403);
    expect((await c.as.admin.get(`/patients/${c.patientId}/export`)).status).toBe(403);
    expect((await c.as.outsider.get(`/patients/${c.patientId}/export`)).status).toBe(404);
    expect((await c.as.secretary.get(`/patients/${MISSING}/export`)).status).toBe(404);
  });
});
