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
import { isOverlapViolation } from '../src/scheduling/scheduling.service.js';

let t: TestApp;

// Segunda-feira, 2 de março de 2026, 09:00 em São Paulo (UTC-3).
const NOW = '2026-03-02T12:00:00.000Z';

beforeAll(async () => {
  // Sessões longas: alguns testes avançam o relógio em horas.
  t = await startTestApp({ SESSION_IDLE_MINUTES: '100000', SESSION_ABSOLUTE_HOURS: '100000' });
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await resetData(t.db);
  t.clock.set(NOW);
});

const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;

/** Terça-feira, 3 de março de 2026, no horário local informado. */
const tue = (hhmm: string) => `2026-03-03T${hhmm}:00-03:00`;
const utc = (local: string) => new Date(local).toISOString();

const WEEKDAY_RULES = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, start: '08:00', end: '12:00' },
  { weekday, start: '14:00', end: '18:00' },
]);

interface Clinic {
  organizationId: string;
  unitId: string;
  otherUnitId: string;
  scheduleId: string;
  otherScheduleId: string;
  doctor: TestUser;
  patients: string[];
  as: {
    admin: Client;
    doctor: Client;
    otherDoctor: Client;
    secretary: Client;
    otherUnitSecretary: Client;
  };
}

let phoneCounter = 0;

async function createPatient(client: Client, fullName: string): Promise<string> {
  phoneCounter += 1;
  const res = await client.post('/patients', {
    fullName,
    birthDate: '1980-05-20',
    phones: [{ number: `(11) 9${String(87650000 + phoneCounter)}` }],
    allowPossibleDuplicate: true,
  });
  if (res.status !== 201) throw new Error(`Falha ao cadastrar paciente: ${res.status}`);
  return res.body.id;
}

async function setupClinic(): Promise<Clinic> {
  const org = await t.db.organization.create({ data: { name: 'Clínica Fictícia' } });
  const unit = await createUnit(t.db, org.id);
  const otherUnit = await createUnit(t.db, org.id);
  const base = { organizationId: org.id, unitIds: [unit.id] };
  const admin = await createUser(t.db, ['admin'], base);
  const doctor = await createUser(t.db, ['doctor'], base);
  const otherDoctor = await createUser(t.db, ['doctor'], base);
  const secretary = await createUser(t.db, ['secretary'], base);
  const otherUnitSecretary = await createUser(t.db, ['secretary'], {
    organizationId: org.id,
    unitIds: [otherUnit.id],
  });
  const professional = await t.db.professional.create({
    data: { organizationId: org.id, userId: doctor.id, crmNumber: '123456', crmState: 'SP' },
  });
  const otherProfessional = await t.db.professional.create({
    data: { organizationId: org.id, userId: otherDoctor.id, crmNumber: '654321', crmState: 'SP' },
  });
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
    otherUnitSecretary: await login(otherUnitSecretary),
  };
  const createSchedule = async (professionalId: string) => {
    const res = await as.secretary.post(`/units/${unit.id}/schedules`, { professionalId });
    if (res.status !== 201) throw new Error(`Falha ao criar agenda: ${res.status}`);
    const rules = await as.secretary.agent
      .put(`/api/v1/schedules/${res.body.id}/rules`)
      .set('x-csrf-token', as.secretary.csrf)
      .send(WEEKDAY_RULES);
    if (rules.status !== 200) throw new Error(`Falha ao definir horários: ${rules.status}`);
    return res.body.id as string;
  };
  const scheduleId = await createSchedule(professional.id);
  const otherScheduleId = await createSchedule(otherProfessional.id);
  const patients = [];
  for (const name of ['Ana Fictícia', 'Bruno Fictício', 'Carla Fictícia', 'Davi Fictício']) {
    patients.push(await createPatient(as.secretary, name));
  }
  return {
    organizationId: org.id,
    unitId: unit.id,
    otherUnitId: otherUnit.id,
    scheduleId,
    otherScheduleId,
    doctor,
    patients,
    as,
  };
}

async function book(c: Clinic, extra: Record<string, unknown> = {}, client = c.as.secretary) {
  return client.post('/appointments', {
    scheduleId: c.scheduleId,
    patientId: c.patients[0],
    startsAt: tue('09:00'),
    ...extra,
  });
}

describe('configuração da agenda', () => {
  it('secretária cria a agenda e define os horários; o médico só visualiza', async () => {
    const c = await setupClinic();
    const list = await c.as.doctor.get(`/units/${c.unitId}/schedules`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    const mine = list.body.find((s: { id: string }) => s.id === c.scheduleId);
    expect(mine.slotMinutes).toBe(30);
    expect(mine.rules).toContainEqual({ weekday: 1, start: '08:00', end: '12:00' });

    const denied = await c.as.doctor.patch(`/schedules/${c.scheduleId}`, { slotMinutes: 20 });
    expect(denied.status).toBe(403);
    const ok = await c.as.secretary.patch(`/schedules/${c.scheduleId}`, { slotMinutes: 20 });
    expect(ok.status).toBe(200);
    expect(ok.body.slotMinutes).toBe(20);
  });

  it('administrador configura agendas; quem é de outra unidade não vê', async () => {
    const c = await setupClinic();
    const res = await c.as.admin.patch(`/schedules/${c.scheduleId}`, { active: true });
    expect(res.status).toBe(200);
    const other = await c.as.otherUnitSecretary.get(`/units/${c.unitId}/schedules`);
    expect(other.status).toBe(403);
    const audit = await t.db.auditEvent.findFirstOrThrow({ orderBy: { seq: 'desc' } });
    expect(audit).toMatchObject({ outcome: 'denied', reason: 'other_unit', unitId: c.unitId });
  });

  it('recusa agenda repetida, de profissional fora da unidade, e faixas sobrepostas', async () => {
    const c = await setupClinic();
    const professional = await t.db.professional.findFirstOrThrow({
      where: { userId: c.doctor.id },
    });
    const again = await c.as.secretary.post(`/units/${c.unitId}/schedules`, {
      professionalId: professional.id,
    });
    expect(again.status).toBe(409);
    // O administrador também pertence à outra unidade, mas o médico não.
    const admin = await t.db.user.findFirstOrThrow({
      where: { organizationId: c.organizationId, roles: { has: 'admin' } },
    });
    await t.db.unitMembership.create({ data: { userId: admin.id, unitId: c.otherUnitId } });
    const outside = await c.as.admin.post(`/units/${c.otherUnitId}/schedules`, {
      professionalId: professional.id,
    });
    expect(outside.status).toBe(422);
    const overlapping = await c.as.secretary.agent
      .put(`/api/v1/schedules/${c.scheduleId}/rules`)
      .set('x-csrf-token', c.as.secretary.csrf)
      .send([
        { weekday: 1, start: '08:00', end: '12:00' },
        { weekday: 1, start: '11:00', end: '13:00' },
      ]);
    expect(overlapping.status).toBe(400);
  });

  it('agenda de outra organização responde 404, com auditoria', async () => {
    const c = await setupClinic();
    const stranger = await createUser(t.db, ['secretary']);
    const client = new Client(t.app);
    await client.loginFully(stranger, t.clock);
    const res = await client.get(`/schedules/${c.scheduleId}/availability?date=2026-03-03`);
    expect(res.status).toBe(404);
    const audit = await t.db.auditEvent.findFirstOrThrow({ orderBy: { seq: 'desc' } });
    expect(audit).toMatchObject({ outcome: 'not_found', resourceId: c.scheduleId });
  });
});

describe('disponibilidade', () => {
  it('lista os horários livres, sem os que já passaram, os ocupados e os bloqueados', async () => {
    const c = await setupClinic();
    const path = `/schedules/${c.scheduleId}/availability`;
    const tuesday = await c.as.secretary.get(`${path}?date=2026-03-03`);
    expect(tuesday.status).toBe(200);
    expect(tuesday.body).toHaveLength(16);
    expect(tuesday.body[0]).toEqual({ startsAt: utc(tue('08:00')), endsAt: utc(tue('08:30')) });

    // Hoje (segunda) já são 09:00: sobram 6 horários de manhã e 8 à tarde.
    const today = await c.as.secretary.get(`${path}?date=2026-03-02`);
    expect(today.body).toHaveLength(14);

    expect((await book(c)).status).toBe(201);
    const block = await c.as.secretary.post(`/schedules/${c.scheduleId}/blocks`, {
      startsAt: tue('14:00'),
      endsAt: tue('16:00'),
      reason: 'Reunião da equipe',
    });
    expect(block.status).toBe(201);
    const after = await c.as.secretary.get(`${path}?date=2026-03-03`);
    expect(after.body).toHaveLength(16 - 1 - 4);
    expect(after.body.map((s: { startsAt: string }) => s.startsAt)).not.toContain(
      utc(tue('09:00')),
    );

    const sunday = await c.as.secretary.get(`${path}?date=2026-03-08`);
    expect(sunday.body).toEqual([]);
  });
});

describe('marcação', () => {
  it('secretária marca consulta; o evento de criação e a auditoria ficam registrados', async () => {
    const c = await setupClinic();
    const res = await book(c, { notes: 'Trazer exames anteriores' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      scheduleId: c.scheduleId,
      unitId: c.unitId,
      patient: { id: c.patients[0], displayName: 'Ana Fictícia' },
      startsAt: utc(tue('09:00')),
      endsAt: utc(tue('09:30')),
      kind: 'regular',
      status: 'scheduled',
    });
    const audit = await t.db.auditEvent.findFirstOrThrow({
      where: { resourceType: 'appointment', action: 'create' },
    });
    expect(audit).toMatchObject({
      outcome: 'allowed',
      unitId: c.unitId,
      patientId: c.patients[0],
    });
    const history = await c.as.secretary.get(`/appointments/${res.body.id}/history`);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ type: 'created', by: { name: expect.any(String) } });
  });

  it('médico, administrador e secretária de outra unidade não marcam', async () => {
    const c = await setupClinic();
    expect((await book(c, {}, c.as.doctor)).status).toBe(403);
    expect((await book(c, {}, c.as.admin)).status).toBe(403);
    expect((await book(c, {}, c.as.otherUnitSecretary)).status).toBe(403);
    expect(await t.db.appointment.count()).toBe(0);
  });

  it('recusa horário ocupado, sobreposição parcial, e aceita encaixe', async () => {
    const c = await setupClinic();
    expect((await book(c)).status).toBe(201);
    const same = await book(c, { patientId: c.patients[1] });
    expect(same.status).toBe(409);
    expect(errorCode(same.body)).toBe('SLOT_TAKEN');
    const partial = await book(c, { patientId: c.patients[1], startsAt: tue('09:15') });
    expect(errorCode(partial.body)).toBe('SLOT_TAKEN');
    const fitIn = await book(c, { patientId: c.patients[1], kind: 'fit_in' });
    expect(fitIn.status).toBe(201);
    const next = await book(c, { patientId: c.patients[2], startsAt: tue('09:30') });
    expect(next.status).toBe(201);
  });

  it('recusa fora do horário, no passado e fora do múltiplo de 5 minutos', async () => {
    const c = await setupClinic();
    for (const startsAt of [
      tue('07:30'),
      tue('12:00'),
      tue('11:45'),
      '2026-03-08T09:00:00-03:00',
    ]) {
      const res = await book(c, { startsAt });
      expect(res.status).toBe(422);
      expect(errorCode(res.body)).toBe('OUTSIDE_WORKING_HOURS');
    }
    const past = await book(c, { startsAt: '2026-03-02T08:30:00-03:00' });
    expect(past.status).toBe(422);
    const odd = await book(c, { startsAt: tue('09:03') });
    expect(odd.status).toBe(422);
    const long = await book(c, { startsAt: tue('11:00'), durationMinutes: 90 });
    expect(errorCode(long.body)).toBe('OUTSIDE_WORKING_HOURS');
  });

  it('duas marcações simultâneas no mesmo horário: só uma é aceita', async () => {
    const c = await setupClinic();
    const results = await Promise.all(
      c.patients.map((patientId) => book(c, { patientId, startsAt: tue('10:00') })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(errorCode(r.body)).toBe('SLOT_TAKEN');
    }
    expect(await t.db.appointment.count()).toBe(1);
  });

  it('o próprio banco recusa sobreposição gravada direto, sem passar pela API', async () => {
    const c = await setupClinic();
    const first = await book(c);
    const row = await t.db.appointment.findUniqueOrThrow({ where: { id: first.body.id } });
    const attempt = t.db.appointment.create({
      data: {
        organizationId: row.organizationId,
        unitId: row.unitId,
        scheduleId: row.scheduleId,
        patientId: c.patients[1] as string,
        startsAt: new Date(utc(tue('09:10'))),
        endsAt: new Date(utc(tue('09:40'))),
        createdByUserId: row.createdByUserId,
      },
    });
    const error = await attempt.then(
      () => null,
      (e: unknown) => e,
    );
    expect(String(error)).toMatch(/appointments_no_overlap|23P01/);
    // É esse erro que a API traduz em 409 SLOT_TAKEN.
    expect(isOverlapViolation(error)).toBe(true);
    expect(isOverlapViolation(new Error('outro erro'))).toBe(false);
  });

  it('o mesmo paciente não fica em duas consultas ao mesmo tempo, mesmo em agendas diferentes', async () => {
    const c = await setupClinic();
    expect((await book(c)).status).toBe(201);
    const res = await book(c, { scheduleId: c.otherScheduleId, startsAt: tue('09:15') });
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe('PATIENT_DOUBLE_BOOKED');
  });

  it('retorno aponta consulta anterior do mesmo paciente', async () => {
    const c = await setupClinic();
    const first = await book(c);
    const ret = await book(c, {
      kind: 'return',
      returnOfId: first.body.id,
      startsAt: '2026-03-10T09:00:00-03:00',
    });
    expect(ret.status).toBe(201);
    expect(ret.body).toMatchObject({ kind: 'return', returnOfId: first.body.id });
    const otherPatient = await book(c, {
      patientId: c.patients[1],
      kind: 'return',
      returnOfId: first.body.id,
      startsAt: '2026-03-11T09:00:00-03:00',
    });
    expect(otherPatient.status).toBe(422);
    const missing = await book(c, { kind: 'return', startsAt: '2026-03-12T09:00:00-03:00' });
    expect(missing.status).toBe(400);
  });
});

describe('bloqueios', () => {
  it('não bloqueia por cima de consulta; consulta em período bloqueado é recusada', async () => {
    const c = await setupClinic();
    const path = `/schedules/${c.scheduleId}/blocks`;
    expect((await book(c)).status).toBe(201);
    const over = await c.as.secretary.post(path, {
      startsAt: tue('08:00'),
      endsAt: tue('12:00'),
      reason: 'Congresso',
    });
    expect(over.status).toBe(409);
    expect(errorCode(over.body)).toBe('BLOCK_HAS_APPOINTMENTS');

    const block = await c.as.secretary.post(path, {
      startsAt: tue('10:00'),
      endsAt: tue('12:00'),
      reason: 'Congresso',
    });
    expect(block.status).toBe(201);
    const blocked = await book(c, { patientId: c.patients[1], startsAt: tue('10:30') });
    expect(blocked.status).toBe(422);
    expect(errorCode(blocked.body)).toBe('SLOT_BLOCKED');
    const fitIn = await book(c, {
      patientId: c.patients[1],
      startsAt: tue('10:30'),
      kind: 'fit_in',
    });
    expect(errorCode(fitIn.body)).toBe('SLOT_BLOCKED');

    const doctorTry = await c.as.doctor.post(`${path}/${block.body.id}/remove`);
    expect(doctorTry.status).toBe(403);
    const removed = await c.as.secretary.post(`${path}/${block.body.id}/remove`);
    expect(removed.status).toBe(204);
    expect((await c.as.secretary.post(`${path}/${block.body.id}/remove`)).status).toBe(404);
    expect((await book(c, { patientId: c.patients[1], startsAt: tue('10:30') })).status).toBe(201);
    // O bloqueio removido continua no banco.
    expect(await t.db.scheduleBlock.count({ where: { removedAt: { not: null } } })).toBe(1);
  });
});

describe('quem vê as consultas', () => {
  const range = `from=${encodeURIComponent(tue('00:00'))}&to=${encodeURIComponent(tue('23:59'))}`;

  it('médico vê só as consultas da própria agenda e não altera', async () => {
    const c = await setupClinic();
    const appt = await book(c);
    const own = await c.as.doctor.get(`/schedules/${c.scheduleId}/appointments?${range}`);
    expect(own.status).toBe(200);
    expect(own.body).toHaveLength(1);
    expect((await c.as.doctor.get(`/appointments/${appt.body.id}`)).status).toBe(200);

    const other = await c.as.otherDoctor.get(`/schedules/${c.scheduleId}/appointments?${range}`);
    expect(other.status).toBe(403);
    expect((await c.as.otherDoctor.get(`/appointments/${appt.body.id}`)).status).toBe(403);
    expect((await c.as.doctor.post(`/appointments/${appt.body.id}/confirm`)).status).toBe(403);
  });

  it('administrador não vê consultas nem lista de espera', async () => {
    const c = await setupClinic();
    const appt = await book(c);
    expect((await c.as.admin.get(`/schedules/${c.scheduleId}/appointments?${range}`)).status).toBe(
      403,
    );
    expect((await c.as.admin.get(`/appointments/${appt.body.id}`)).status).toBe(403);
    expect((await c.as.admin.get(`/units/${c.unitId}/waitlist`)).status).toBe(403);
    const audit = await t.db.auditEvent.findFirstOrThrow({ orderBy: { seq: 'desc' } });
    expect(audit).toMatchObject({ outcome: 'denied', resourceType: 'appointment' });
  });

  it('secretária de outra unidade não vê; consulta inexistente responde 404', async () => {
    const c = await setupClinic();
    const appt = await book(c);
    expect((await c.as.otherUnitSecretary.get(`/appointments/${appt.body.id}`)).status).toBe(403);
    const missing = await c.as.secretary.get('/appointments/0199a000-0000-7000-8000-000000000000');
    expect(missing.status).toBe(404);
  });

  it('limita a consulta a 31 dias', async () => {
    const c = await setupClinic();
    const res = await c.as.secretary.get(
      `/schedules/${c.scheduleId}/appointments?from=2026-03-01T00:00:00Z&to=2026-04-05T00:00:00Z`,
    );
    expect(res.status).toBe(400);
  });
});

describe('estados da consulta', () => {
  it('confirma, marca presença a partir de 2 horas antes e não cancela depois da chegada', async () => {
    const c = await setupClinic();
    const { body } = await book(c);
    const path = `/appointments/${body.id}`;
    expect((await c.as.secretary.post(`${path}/confirm`)).body.status).toBe('confirmed');
    const twice = await c.as.secretary.post(`${path}/confirm`);
    expect(twice.status).toBe(409);
    expect(errorCode(twice.body)).toBe('INVALID_STATE_TRANSITION');

    const early = await c.as.secretary.post(`${path}/check-in`);
    expect(early.status).toBe(422);
    t.clock.set(utc(tue('07:00')));
    const arrived = await c.as.secretary.post(`${path}/check-in`);
    expect(arrived.status).toBe(200);
    expect(arrived.body.status).toBe('arrived');
    const cancel = await c.as.secretary.post(`${path}/cancel`, {
      reason: 'Desistiu',
      requestedBy: 'patient',
    });
    expect(errorCode(cancel.body)).toBe('INVALID_STATE_TRANSITION');

    const history = await c.as.secretary.get(`${path}/history`);
    expect(history.body.map((e: { type: string }) => e.type)).toEqual([
      'created',
      'confirmed',
      'arrived',
    ]);
  });

  it('falta só depois do horário de início', async () => {
    const c = await setupClinic();
    const { body } = await book(c);
    const path = `/appointments/${body.id}/no-show`;
    expect((await c.as.secretary.post(path)).status).toBe(422);
    t.clock.set(utc(tue('09:20')));
    const res = await c.as.secretary.post(path);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_show');
  });

  it('cancelamento exige motivo e quem pediu, e libera o horário', async () => {
    const c = await setupClinic();
    const { body } = await book(c);
    const path = `/appointments/${body.id}/cancel`;
    expect((await c.as.secretary.post(path, { reason: 'Viagem' })).status).toBe(400);
    const res = await c.as.secretary.post(path, { reason: 'Viagem', requestedBy: 'patient' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Viagem',
      cancelRequestedBy: 'patient',
    });
    expect((await book(c, { patientId: c.patients[1] })).status).toBe(201);
    const history = await c.as.secretary.get(`/appointments/${body.id}/history`);
    expect(history.body[1]).toMatchObject({
      type: 'cancelled',
      details: { reason: 'Viagem', requestedBy: 'patient' },
    });
  });

  it('o histórico de eventos não pode ser alterado nem apagado', async () => {
    const c = await setupClinic();
    await book(c);
    await expect(
      t.db.$executeRawUnsafe(`UPDATE scheduling.appointment_events SET type = 'x'`),
    ).rejects.toThrow();
    await expect(
      t.db.$executeRawUnsafe(`DELETE FROM scheduling.appointment_events`),
    ).rejects.toThrow();
  });
});

describe('reagendamento', () => {
  it('cria consulta nova ligada à antiga, preservando o histórico das duas', async () => {
    const c = await setupClinic();
    const { body: old } = await book(c, { notes: 'Trazer exames' });
    const res = await c.as.secretary.post(`/appointments/${old.id}/reschedule`, {
      startsAt: tue('15:00'),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'scheduled',
      startsAt: utc(tue('15:00')),
      endsAt: utc(tue('15:30')),
      rescheduledFromId: old.id,
      notes: 'Trazer exames',
    });
    const before = await c.as.secretary.get(`/appointments/${old.id}`);
    expect(before.body).toMatchObject({ status: 'rescheduled', rescheduledToId: res.body.id });

    const oldHistory = await c.as.secretary.get(`/appointments/${old.id}/history`);
    expect(oldHistory.body.map((e: { type: string }) => e.type)).toEqual([
      'created',
      'rescheduled',
    ]);
    expect(oldHistory.body[1].details).toMatchObject({ toId: res.body.id });
    const newHistory = await c.as.secretary.get(`/appointments/${res.body.id}/history`);
    expect(newHistory.body[0]).toMatchObject({
      type: 'created',
      details: { rescheduledFromId: old.id },
    });

    // O horário antigo fica livre, e a consulta antiga não pode ser reagendada de novo.
    expect((await book(c, { patientId: c.patients[1] })).status).toBe(201);
    const again = await c.as.secretary.post(`/appointments/${old.id}/reschedule`, {
      startsAt: tue('16:00'),
    });
    expect(errorCode(again.body)).toBe('INVALID_STATE_TRANSITION');
  });

  it('se o novo horário estiver ocupado, nada muda na consulta original', async () => {
    const c = await setupClinic();
    const { body: old } = await book(c);
    await book(c, { patientId: c.patients[1], startsAt: tue('15:00') });
    const res = await c.as.secretary.post(`/appointments/${old.id}/reschedule`, {
      startsAt: tue('15:00'),
    });
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe('SLOT_TAKEN');
    const still = await c.as.secretary.get(`/appointments/${old.id}`);
    expect(still.body).toMatchObject({ status: 'scheduled', rescheduledToId: null });
    expect(await t.db.appointmentEvent.count({ where: { appointmentId: old.id } })).toBe(1);
  });

  it('pode mudar para um horário que se sobrepõe ao próprio horário antigo', async () => {
    const c = await setupClinic();
    const { body: old } = await book(c);
    const res = await c.as.secretary.post(`/appointments/${old.id}/reschedule`, {
      startsAt: tue('09:15'),
    });
    expect(res.status).toBe(201);
  });
});

describe('lista de espera', () => {
  it('secretária inclui, lista, marca a partir da entrada e remove com motivo', async () => {
    const c = await setupClinic();
    const path = `/units/${c.unitId}/waitlist`;
    const add = await c.as.secretary.post(path, {
      patientId: c.patients[0],
      preference: 'Manhãs',
    });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ status: 'waiting', patient: { displayName: 'Ana Fictícia' } });
    expect((await c.as.secretary.post(path, { patientId: c.patients[0] })).status).toBe(409);
    const second = await c.as.secretary.post(path, { patientId: c.patients[1] });

    expect((await c.as.doctor.get(path)).status).toBe(403);
    expect((await c.as.otherUnitSecretary.post(path, { patientId: c.patients[2] })).status).toBe(
      403,
    );
    expect((await c.as.secretary.get(path)).body).toHaveLength(2);

    const appt = await book(c, { waitlistEntryId: add.body.id });
    expect(appt.status).toBe(201);
    const entry = await t.db.waitlistEntry.findUniqueOrThrow({ where: { id: add.body.id } });
    expect(entry).toMatchObject({ status: 'scheduled', appointmentId: appt.body.id });

    const wrongPatient = await book(c, {
      patientId: c.patients[2],
      startsAt: tue('10:00'),
      waitlistEntryId: second.body.id,
    });
    expect(wrongPatient.status).toBe(422);

    const remove = `/waitlist/${second.body.id}/remove`;
    expect((await c.as.doctor.post(remove, { reason: 'Conseguiu vaga' })).status).toBe(403);
    expect((await c.as.secretary.post(remove, { reason: 'Conseguiu vaga' })).status).toBe(204);
    expect((await c.as.secretary.post(remove, { reason: 'Conseguiu vaga' })).status).toBe(409);
    expect((await c.as.secretary.get(path)).body).toEqual([]);
  });
});
