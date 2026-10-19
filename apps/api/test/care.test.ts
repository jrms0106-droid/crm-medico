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
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeAll(async () => {
  // Sessões longas: os testes avançam o relógio em semanas.
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

const NOTHING = {
  viewSummary: false,
  viewHistory: false,
  createRecords: false,
  viewOwnRecords: false,
  viewSensitiveOfOthers: 'denied',
};
/** Para o médico, os registros de sua autoria estão sempre liberados (obrigação documental). */
const ONLY_OWN = { ...NOTHING, viewOwnRecords: true };

interface Clinic {
  organizationId: string;
  patientId: string;
  scheduleId: string;
  otherScheduleId: string;
  doctor: TestUser;
  otherDoctor: TestUser;
  as: { admin: Client; doctor: Client; otherDoctor: Client; secretary: Client };
}

async function setupClinic(): Promise<Clinic> {
  const org = await t.db.organization.create({ data: { name: 'Clínica Fictícia' } });
  const unit = await createUnit(t.db, org.id);
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
  const scheduleFor = async (userId: string, crmNumber: string) => {
    const professional = await t.db.professional.create({
      data: { organizationId: org.id, userId, crmNumber, crmState: 'SP' },
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
  const scheduleId = await scheduleFor(doctor.id, '111111');
  const otherScheduleId = await scheduleFor(otherDoctor.id, '222222');
  const patient = await as.secretary.post('/patients', {
    fullName: 'Paciente Fictícia',
    birthDate: '1980-05-20',
    phones: [{ number: '(11) 98765-4321' }],
  });
  if (patient.status !== 201) throw new Error(`Falha ao cadastrar paciente: ${patient.status}`);
  return {
    organizationId: org.id,
    patientId: patient.body.id,
    scheduleId,
    otherScheduleId,
    doctor,
    otherDoctor,
    as,
  };
}

async function book(c: Clinic, startsAt = tue('09:00'), scheduleId = c.scheduleId) {
  const res = await c.as.secretary.post('/appointments', {
    scheduleId,
    patientId: c.patientId,
    startsAt,
  });
  if (res.status !== 201) throw new Error(`Falha ao marcar: ${res.status}`);
  return res.body.id as string;
}

/** Marca, confirma, registra a chegada (a partir de 2 h antes) e inicia o atendimento. */
async function startEncounter(c: Clinic) {
  const appointmentId = await book(c);
  await c.as.secretary.post(`/appointments/${appointmentId}/confirm`);
  t.clock.set(new Date(tue('08:30')));
  await c.as.secretary.post(`/appointments/${appointmentId}/check-in`);
  const res = await c.as.doctor.post(`/appointments/${appointmentId}/encounter`);
  if (res.status !== 201) throw new Error(`Falha ao iniciar atendimento: ${res.status}`);
  return { appointmentId, encounterId: res.body.id as string };
}

async function access(c: Clinic, client = c.as.doctor) {
  const res = await client.get(`/patients/${c.patientId}/care-access`);
  expect(res.status).toBe(200);
  return res.body;
}

describe('o vínculo, estado por estado', () => {
  it('sem vínculo: o médico não vê nada clínico', async () => {
    const c = await setupClinic();
    expect(await access(c)).toEqual({ state: null, emergencyUntil: null, can: ONLY_OWN });
  });

  it('agendado e confirmado: só o resumo de segurança, nunca o histórico', async () => {
    const c = await setupClinic();
    const appointmentId = await book(c);
    const scheduled = await access(c);
    expect(scheduled.state).toBe('scheduled');
    expect(scheduled.can).toEqual({ ...ONLY_OWN, viewSummary: true });
    await c.as.secretary.post(`/appointments/${appointmentId}/confirm`);
    const confirmed = await access(c);
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.can).toEqual({ ...ONLY_OWN, viewSummary: true });
    // O médico da outra agenda continua sem vínculo.
    expect((await access(c, c.as.otherDoctor)).state).toBeNull();
  });

  it('atendimento iniciado: histórico e registros novos; sensível de outros exige justificativa', async () => {
    const c = await setupClinic();
    await startEncounter(c);
    expect(await access(c)).toMatchObject({
      state: 'started',
      can: {
        viewSummary: true,
        viewHistory: true,
        createRecords: true,
        viewOwnRecords: true,
        viewSensitiveOfOthers: 'justification_required',
      },
    });
  });

  it('encerrado: histórico por 30 dias, sem registros novos; depois expira', async () => {
    const c = await setupClinic();
    const { encounterId } = await startEncounter(c);
    const closed = await c.as.doctor.post(`/encounters/${encounterId}/close`, {});
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({ status: 'closed', followUpUntil: null });
    expect(await access(c)).toMatchObject({
      state: 'closed',
      can: { viewHistory: true, createRecords: false, viewOwnRecords: true },
    });

    t.clock.advance(29 * DAY);
    expect((await access(c)).state).toBe('closed');
    t.clock.advance(2 * DAY);
    const expired = await access(c);
    expect(expired.state).toBe('expired');
    // Expiração revoga o acesso a registros de outros autores; os próprios continuam.
    expect(expired.can).toEqual(ONLY_OWN);
  });

  it('acompanhamento ativo: histórico e registros novos até o fim do prazo', async () => {
    const c = await setupClinic();
    const { encounterId } = await startEncounter(c);
    const res = await c.as.doctor.post(`/encounters/${encounterId}/close`, { followUpDays: 60 });
    expect(res.body.followUpUntil).not.toBeNull();
    expect(await access(c)).toMatchObject({
      state: 'follow_up',
      can: { viewHistory: true, createRecords: true },
    });
    t.clock.advance(59 * DAY);
    expect((await access(c)).state).toBe('follow_up');
    t.clock.advance(2 * DAY);
    expect((await access(c)).state).toBe('expired');
  });

  it('secretária não tem acesso clínico; administrador nem consulta o vínculo', async () => {
    const c = await setupClinic();
    await startEncounter(c);
    expect(await access(c, c.as.secretary)).toEqual({
      state: null,
      emergencyUntil: null,
      can: NOTHING,
    });
    expect((await c.as.admin.get(`/patients/${c.patientId}/care-access`)).status).toBe(403);
  });
});

describe('atendimento', () => {
  it('só começa com o paciente na recepção e pelo médico dono da agenda', async () => {
    const c = await setupClinic();
    const appointmentId = await book(c);
    const path = `/appointments/${appointmentId}/encounter`;
    const early = await c.as.doctor.post(path);
    expect(early.status).toBe(409);
    expect(errorCode(early.body)).toBe('INVALID_STATE_TRANSITION');

    t.clock.set(new Date(tue('08:30')));
    await c.as.secretary.post(`/appointments/${appointmentId}/check-in`);
    expect((await c.as.secretary.post(path)).status).toBe(403);
    expect((await c.as.admin.post(path)).status).toBe(403);
    const other = await c.as.otherDoctor.post(path);
    expect(other.status).toBe(403);
    const audit = await t.db.auditEvent.findFirstOrThrow({ orderBy: { seq: 'desc' } });
    expect(audit).toMatchObject({ outcome: 'denied', reason: 'not_own_schedule' });

    const ok = await c.as.doctor.post(path);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ status: 'started', patientId: c.patientId });
    expect((await c.as.doctor.post(path)).status).toBe(409);
  });

  it('um único atendimento aberto por médico e paciente, garantido também no banco', async () => {
    const c = await setupClinic();
    const { encounterId } = await startEncounter(c);
    const second = await book(c, tue('10:00'));
    await c.as.secretary.post(`/appointments/${second}/check-in`);
    const res = await c.as.doctor.post(`/appointments/${second}/encounter`);
    expect(res.status).toBe(409);
    expect(await t.db.encounter.count()).toBe(1);
    await c.as.doctor.post(`/encounters/${encounterId}/close`, {});
    expect((await c.as.doctor.post(`/appointments/${second}/encounter`)).status).toBe(201);
  });

  it('só o médico do atendimento encerra; quem não tem vínculo não vê', async () => {
    const c = await setupClinic();
    const { encounterId } = await startEncounter(c);
    expect((await c.as.otherDoctor.get(`/encounters/${encounterId}`)).status).toBe(403);
    expect((await c.as.secretary.get(`/encounters/${encounterId}`)).status).toBe(403);
    const close = await c.as.otherDoctor.post(`/encounters/${encounterId}/close`, {});
    expect(close.status).toBe(403);
    expect((await c.as.doctor.get(`/encounters/${encounterId}`)).status).toBe(200);
    const bad = await c.as.doctor.post(`/encounters/${encounterId}/close`, { followUpDays: 0 });
    expect(bad.status).toBe(400);
    expect((await c.as.doctor.post(`/encounters/${encounterId}/close`, {})).status).toBe(200);
    // Encerrado, o vínculo passa a "encerrado", que não permite mexer no atendimento.
    expect((await c.as.doctor.post(`/encounters/${encounterId}/close`, {})).status).toBe(403);
    expect((await c.as.doctor.get(`/encounters/${encounterId}`)).status).toBe(200);
  });
});

describe('acesso emergencial', () => {
  it('exige reautenticação e justificativa, libera só leitura e expira sozinho', async () => {
    const c = await setupClinic();
    const path = `/patients/${c.patientId}/emergency-access`;
    const justification = 'Paciente desacordado no pronto atendimento, precisa de alergias.';
    const noReauth = await c.as.otherDoctor.post(path, { justification });
    expect(noReauth.status).toBe(403);
    expect(errorCode(noReauth.body)).toBe('REAUTH_REQUIRED');

    await c.as.otherDoctor.reauth(c.otherDoctor, t.clock);
    expect((await c.as.otherDoctor.post(path, { justification: 'urgente' })).status).toBe(400);
    const granted = await c.as.otherDoctor.post(path, { justification });
    expect(granted.status).toBe(201);
    expect(granted.body).toMatchObject({ active: true, review: null, patientId: c.patientId });
    expect(new Date(granted.body.expiresAt).getTime() - t.clock.now().getTime()).toBe(4 * HOUR);

    const during = await access(c, c.as.otherDoctor);
    expect(during.state).toBeNull();
    expect(during.emergencyUntil).toBe(granted.body.expiresAt);
    expect(during.can).toEqual({
      viewSummary: true,
      viewHistory: true,
      createRecords: false,
      viewOwnRecords: true,
      viewSensitiveOfOthers: 'allowed',
    });

    t.clock.advance(4 * HOUR);
    expect(await access(c, c.as.otherDoctor)).toEqual({
      state: null,
      emergencyUntil: null,
      can: ONLY_OWN,
    });
  });

  it('secretária e administrador não pedem acesso emergencial', async () => {
    const c = await setupClinic();
    const body = { justification: 'Tentativa sem ser médico, deve ser negada.' };
    for (const client of [c.as.secretary, c.as.admin]) {
      expect((await client.post(`/patients/${c.patientId}/emergency-access`, body)).status).toBe(
        403,
      );
    }
  });

  it('entra na fila de revisão do administrador, revisada uma única vez', async () => {
    const c = await setupClinic();
    await c.as.otherDoctor.reauth(c.otherDoctor, t.clock);
    const granted = await c.as.otherDoctor.post(`/patients/${c.patientId}/emergency-access`, {
      justification: 'Paciente desacordado no pronto atendimento, precisa de alergias.',
    });
    const grantAudit = await t.db.auditEvent.findFirstOrThrow({
      where: { reason: 'emergency_access_granted' },
    });
    expect(grantAudit).toMatchObject({ patientId: c.patientId, actorUserId: c.otherDoctor.id });

    expect((await c.as.doctor.get('/emergency-access/reviews')).status).toBe(403);
    expect((await c.as.secretary.get('/emergency-access/reviews')).status).toBe(403);
    const pending = await c.as.admin.get('/emergency-access/reviews');
    expect(pending.status).toBe(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({
      id: granted.body.id,
      requestedBy: { id: c.otherDoctor.id },
      review: null,
    });

    const reviewPath = `/emergency-access/${granted.body.id}/review`;
    expect(
      (await c.as.doctor.post(reviewPath, { outcome: 'appropriate', notes: 'Ok' })).status,
    ).toBe(403);
    const reviewed = await c.as.admin.post(reviewPath, {
      outcome: 'appropriate',
      notes: 'Atendimento de urgência confirmado.',
    });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.review).toMatchObject({ outcome: 'appropriate' });
    const again = await c.as.admin.post(reviewPath, { outcome: 'inappropriate', notes: 'Mudou' });
    expect(again.status).toBe(409);
    expect((await c.as.admin.get('/emergency-access/reviews')).body).toEqual([]);
    expect((await c.as.admin.get('/emergency-access/reviews?status=reviewed')).body).toHaveLength(
      1,
    );
  });

  it('o registro do acesso emergencial não pode ser apagado nem alterado no banco', async () => {
    const c = await setupClinic();
    await c.as.otherDoctor.reauth(c.otherDoctor, t.clock);
    await c.as.otherDoctor.post(`/patients/${c.patientId}/emergency-access`, {
      justification: 'Paciente desacordado no pronto atendimento, precisa de alergias.',
    });
    await expect(t.db.$executeRawUnsafe(`DELETE FROM care.emergency_accesses`)).rejects.toThrow();
    await expect(
      t.db.$executeRawUnsafe(
        `UPDATE care.emergency_accesses SET justification = 'outra coisa qualquer aqui'`,
      ),
    ).rejects.toThrow();
  });
});
