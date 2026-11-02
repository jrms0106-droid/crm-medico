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
const tue = (hhmm: string) => `2026-03-03T${hhmm}:00-03:00`;

interface Clinic {
  patientId: string;
  doctor: TestUser;
  otherDoctor: TestUser;
  as: { admin: Client; doctor: Client; otherDoctor: Client; secretary: Client };
}

let schedules: { doctor: string; otherDoctor: string };

async function setupClinic(): Promise<Clinic> {
  const org = await t.db.organization.create({ data: { name: 'Clínica Fictícia' } });
  const unit = await createUnit(t.db, org.id, 'Unidade Centro');
  const base = { organizationId: org.id, unitIds: [unit.id] };
  const admin = await createUser(t.db, ['admin'], base);
  const doctor = await createUser(t.db, ['doctor'], base);
  const otherDoctor = await createUser(t.db, ['doctor'], base);
  const secretary = await createUser(t.db, ['secretary'], base);
  const login = async (user: TestUser) => {
    const client = new Client(t.app);
    await client.loginFully(user, t.clock);
    return client;
  };
  const as = {
    admin: await login(admin),
    doctor: await login(doctor),
    otherDoctor: await login(otherDoctor),
    secretary: await login(secretary),
  };
  const specialty = await t.db.specialty.create({
    data: { organizationId: org.id, name: 'Clínica Médica' },
  });
  const scheduleFor = async (userId: string, crmNumber: string) => {
    const professional = await t.db.professional.create({
      data: {
        organizationId: org.id,
        userId,
        crmNumber,
        crmState: 'SP',
        specialties: { create: { specialtyId: specialty.id, rqe: '12345' } },
      },
    });
    const schedule = await t.db.schedule.create({
      data: { organizationId: org.id, unitId: unit.id, professionalId: professional.id },
    });
    await t.db.scheduleRule.createMany({
      data: [1, 2, 3, 4, 5].map((weekday) => ({
        scheduleId: schedule.id,
        weekday,
        startMinute: 8 * 60,
        endMinute: 18 * 60,
      })),
    });
    return schedule.id;
  };
  schedules = {
    doctor: await scheduleFor(doctor.id, '111111'),
    otherDoctor: await scheduleFor(otherDoctor.id, '222222'),
  };
  const patient = await as.secretary.post('/patients', {
    fullName: 'Paciente Fictícia',
    socialName: 'Nome Social Fictício',
    birthDate: '1980-05-20',
    phones: [{ number: '(11) 98765-4321' }],
  });
  if (patient.status !== 201) throw new Error(`Falha ao cadastrar paciente: ${patient.status}`);
  return { patientId: patient.body.id, doctor, otherDoctor, as };
}

async function startEncounter(c: Clinic, who: 'doctor' | 'otherDoctor', time: string) {
  t.clock.set(NOW);
  const booked = await c.as.secretary.post('/appointments', {
    scheduleId: schedules[who],
    patientId: c.patientId,
    startsAt: tue(time),
  });
  if (booked.status !== 201) throw new Error(`Falha ao marcar: ${booked.status}`);
  t.clock.set(new Date(tue('08:30')));
  await c.as.secretary.post(`/appointments/${booked.body.id}/check-in`);
  const res = await c.as[who].post(`/appointments/${booked.body.id}/encounter`);
  if (res.status !== 201) throw new Error(`Falha ao iniciar atendimento: ${res.status}`);
  return res.body.id as string;
}

const RECEITA = {
  kind: 'controlled_prescription',
  issuedOn: '2026-03-03',
  summary: 'Medicamento fictício de controle especial, 1 comprimido à noite por 30 dias.',
  validationCode: 'CODIGO-FICTICIO-123',
};

const path = (c: Clinic) => `/patients/${c.patientId}/external-documents`;

describe('registro de documento emitido no CFM', () => {
  it('médico em atendimento registra; quem tem vínculo vê; código vazio vira nulo', async () => {
    const c = await setupClinic();
    const encounterId = await startEncounter(c, 'doctor', '09:00');
    await startEncounter(c, 'otherDoctor', '10:00');
    const created = await c.as.doctor.post(path(c), RECEITA);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      patientId: c.patientId,
      author: { id: c.doctor.id },
      encounterId,
      platform: 'cfm',
      kind: 'controlled_prescription',
      status: 'registered',
      issuedOn: '2026-03-03',
      summary: RECEITA.summary,
      validationCode: 'CODIGO-FICTICIO-123',
      cancelledAt: null,
    });
    const second = await c.as.doctor.post(path(c), {
      kind: 'certificate',
      issuedOn: '2026-03-01',
      summary: 'Atestado fictício de 1 dia.',
      validationCode: '  ',
    });
    expect(second.status).toBe(201);
    expect(second.body.validationCode).toBeNull();

    const list = await c.as.otherDoctor.get(path(c));
    expect(list.status).toBe(200);
    expect(list.body.map((d: { id: string }) => d.id)).toEqual([created.body.id, second.body.id]);
  });

  it('recusa data no futuro, antes de 2020, resumo curto, tipo desconhecido e campo a mais', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const future = await c.as.doctor.post(path(c), { ...RECEITA, issuedOn: '2026-03-04' });
    expect(future.status).toBe(422);
    for (const body of [
      { ...RECEITA, issuedOn: '2019-12-31' },
      { ...RECEITA, issuedOn: '03/03/2026' },
      { ...RECEITA, summary: 'ab' },
      { ...RECEITA, kind: 'referral' },
      { ...RECEITA, platform: 'outra' },
    ]) {
      expect((await c.as.doctor.post(path(c), body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await t.db.externalDocument.count()).toBe(0);
  });

  it('exige registro profissional ativo', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await t.db.professional.updateMany({ where: { userId: c.doctor.id }, data: { active: false } });
    const res = await c.as.doctor.post(path(c), RECEITA);
    expect(res.status).toBe(422);
    expect(errorCode(res.body)).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('o autor cancela com motivo, uma vez só; outro médico não cancela', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await startEncounter(c, 'otherDoctor', '10:00');
    const created = await c.as.doctor.post(path(c), RECEITA);
    const cancelPath = `/external-documents/${created.body.id}/cancel`;
    const reason = 'Registrado no paciente errado por engano.';
    expect((await c.as.doctor.post(cancelPath, { reason: 'curto' })).status).toBe(400);
    expect((await c.as.otherDoctor.post(cancelPath, { reason })).status).toBe(403);
    const cancelled = await c.as.doctor.post(cancelPath, { reason });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelReason: reason });
    expect(cancelled.body.cancelledAt).not.toBeNull();
    const again = await c.as.doctor.post(cancelPath, { reason });
    expect(again.status).toBe(409);
    expect(errorCode(again.body)).toBe('INVALID_STATE_TRANSITION');
  });

  it('secretária, administrador e médico sem vínculo são barrados; outra organização dá 404', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const created = await c.as.doctor.post(path(c), RECEITA);
    const cancelPath = `/external-documents/${created.body.id}/cancel`;
    const reason = 'Tentativa de cancelar sem ser o autor.';
    for (const who of ['secretary', 'admin'] as const) {
      expect((await c.as[who].post(path(c), RECEITA)).status, who).toBe(403);
      expect((await c.as[who].get(path(c))).status, who).toBe(403);
      expect((await c.as[who].post(cancelPath, { reason })).status, who).toBe(403);
    }
    // Sem atendimento com o paciente, o outro médico não registra nem vê os registros dos outros.
    expect((await c.as.otherDoctor.post(path(c), RECEITA)).status).toBe(403);
    // A lista, como a dos documentos, responde só com o que ele pode ver: nada.
    const list = await c.as.otherDoctor.get(path(c));
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);

    const other = await setupClinic();
    expect((await other.as.doctor.get(path(c))).status).toBe(404);
    expect((await other.as.doctor.post(cancelPath, { reason })).status).toBe(404);
    expect(
      (
        await c.as.doctor.post(`/external-documents/00000000-0000-7000-8000-000000000000/cancel`, {
          reason,
        })
      ).status,
    ).toBe(404);
    const denied = await t.db.auditEvent.count({
      where: { resourceType: 'medical_document', outcome: 'denied' },
    });
    expect(denied).toBe(7);
  });

  it('o banco recusa apagar e alterar o registro', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const created = await c.as.doctor.post(path(c), RECEITA);
    const id = created.body.id as string;
    await expect(t.db.externalDocument.delete({ where: { id } })).rejects.toThrow(
      /não pode ser apagado/,
    );
    await expect(
      t.db.externalDocument.update({ where: { id }, data: { summary: 'Texto trocado.' } }),
    ).rejects.toThrow(/só pode ser cancelado/);
    expect((await t.db.externalDocument.findUniqueOrThrow({ where: { id } })).summary).toBe(
      RECEITA.summary,
    );
  });
});
