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

const CONTENT = {
  chiefComplaint: 'Dor de garganta há três dias (dado fictício).',
  anamnesis: 'Nega febre. Relato fictício para teste.',
  hypotheses: [{ description: 'Faringite viral', icd10: 'j02.9' }],
  plan: 'Hidratação e retorno se piorar.',
};

interface Clinic {
  patientId: string;
  doctor: TestUser;
  otherDoctor: TestUser;
  as: { admin: Client; doctor: Client; otherDoctor: Client; secretary: Client };
  encounters: { doctor?: string; otherDoctor?: string };
}

let schedules: { doctor: string; otherDoctor: string };

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
  schedules = {
    doctor: await scheduleFor(doctor.id, '111111'),
    otherDoctor: await scheduleFor(otherDoctor.id, '222222'),
  };
  const patient = await as.secretary.post('/patients', {
    fullName: 'Paciente Fictícia',
    birthDate: '1980-05-20',
    phones: [{ number: '(11) 98765-4321' }],
  });
  if (patient.status !== 201) throw new Error(`Falha ao cadastrar paciente: ${patient.status}`);
  return { patientId: patient.body.id, doctor, otherDoctor, as, encounters: {} };
}

/** Marca, registra a chegada e inicia o atendimento do médico escolhido. */
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
  c.encounters[who] = res.body.id;
  return res.body.id as string;
}

/** Cria, finaliza e assina um registro (com reautenticação). */
async function signedRecord(
  c: Clinic,
  who: 'doctor' | 'otherDoctor' = 'doctor',
  extra: object = {},
) {
  const created = await c.as[who].post(`/patients/${c.patientId}/records`, {
    content: CONTENT,
    ...extra,
  });
  expect(created.status).toBe(201);
  return finalizeAndSign(c, who, created.body.id, created.body.version);
}

async function finalizeAndSign(
  c: Clinic,
  who: 'doctor' | 'otherDoctor',
  id: string,
  version: number,
) {
  const finalized = await c.as[who].post(`/records/${id}/finalize`, { version });
  expect(finalized.status).toBe(200);
  await c.as[who].reauth(c[who], t.clock);
  const signed = await c.as[who].post(`/records/${id}/sign`, { version });
  expect(signed.status).toBe(200);
  return signed.body;
}

describe('criação e acesso', () => {
  it('o médico com atendimento iniciado cria o rascunho, ligado ao atendimento', async () => {
    const c = await setupClinic();
    const encounterId = await startEncounter(c, 'doctor', '09:00');
    const res = await c.as.doctor.post(`/patients/${c.patientId}/records`, { content: CONTENT });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      version: 1,
      kind: 'consultation',
      encounterId,
      clinicalDate: '2026-03-03',
      sensitivity: 'normal',
      formVersion: 'generic-v1',
      contentHash: null,
      integrity: null,
      author: { id: c.doctor.id },
    });
    expect(res.body.content.hypotheses[0].icd10).toBe('J02.9');
    expect(await t.db.recordVersion.count({ where: { recordId: res.body.id } })).toBe(1);
  });

  it('secretária, administrador e médico sem vínculo não criam nem leem', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const signed = await signedRecord(c);
    const path = `/patients/${c.patientId}/records`;
    for (const client of [c.as.secretary, c.as.admin, c.as.otherDoctor]) {
      expect((await client.post(path, { content: CONTENT })).status).toBe(403);
      expect((await client.get(`/records/${signed.id}`)).status).toBe(403);
      expect((await client.get(`/records/${signed.id}/history`)).status).toBe(403);
    }
    expect((await c.as.secretary.get(path)).status).toBe(403);
    expect((await c.as.admin.get(path)).status).toBe(403);
    // O médico sem vínculo vê a linha do tempo só com os registros dele (nenhum).
    const other = await c.as.otherDoctor.get(path);
    expect(other.status).toBe(200);
    expect(other.body).toEqual([]);
    const denied = await t.db.auditEvent.count({
      where: { resourceType: 'clinical_record', outcome: 'denied' },
    });
    expect(denied).toBeGreaterThanOrEqual(9);
  });

  it('agendamento não libera criar registro', async () => {
    const c = await setupClinic();
    await c.as.secretary.post('/appointments', {
      scheduleId: schedules.doctor,
      patientId: c.patientId,
      startsAt: tue('09:00'),
    });
    const res = await c.as.doctor.post(`/patients/${c.patientId}/records`, { content: CONTENT });
    expect(res.status).toBe(403);
  });

  it('paciente inexistente responde 404; conteúdo inválido, 400', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const missing = '0190a000-0000-7000-8000-000000000000';
    expect((await c.as.doctor.post(`/patients/${missing}/records`, {})).status).toBe(404);
    const bad = await c.as.doctor.post(`/patients/${c.patientId}/records`, {
      content: { hypotheses: [{ description: 'X', icd10: '123' }] },
    });
    expect(bad.status).toBe(400);
  });
});

describe('rascunho e salvamento', () => {
  it('cada gravação cria uma versão; versão desatualizada responde 409 sem gravar nada', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const created = await c.as.doctor.post(`/patients/${c.patientId}/records`, {});
    const id = created.body.id;
    const first = await c.as.doctor.patch(`/records/${id}`, {
      version: 1,
      content: { chiefComplaint: 'Primeira aba' },
    });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(2);
    // Outra aba, ainda na versão 1.
    const stale = await c.as.doctor.patch(`/records/${id}`, {
      version: 1,
      content: { chiefComplaint: 'Segunda aba' },
    });
    expect(stale.status).toBe(409);
    expect(errorCode(stale.body)).toBe('VERSION_CONFLICT');
    const current = await c.as.doctor.get(`/records/${id}`);
    expect(current.body.content).toEqual({ chiefComplaint: 'Primeira aba' });
    const versions = await c.as.doctor.get(`/records/${id}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
  });

  it('duas gravações simultâneas da mesma versão: só uma entra, a outra recebe 409', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const created = await c.as.doctor.post(`/patients/${c.patientId}/records`, {});
    const id = created.body.id;
    const results = await Promise.all(
      ['A', 'B', 'C', 'D'].map((tab) =>
        c.as.doctor.patch(`/records/${id}`, { version: 1, content: { plan: `Aba ${tab}` } }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await t.db.recordVersion.count({ where: { recordId: id } })).toBe(2);
  });

  it('o rascunho é só do autor: outro médico recebe 404', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await startEncounter(c, 'otherDoctor', '10:00');
    const created = await c.as.doctor.post(`/patients/${c.patientId}/records`, {
      content: CONTENT,
    });
    const id = created.body.id;
    expect((await c.as.otherDoctor.get(`/records/${id}`)).status).toBe(404);
    expect((await c.as.otherDoctor.patch(`/records/${id}`, { version: 1 })).status).toBe(404);
    const timeline = await c.as.otherDoctor.get(`/patients/${c.patientId}/records`);
    expect(timeline.body).toEqual([]);
  });

  it('finalizar exige conteúdo; finalizado não é editado, mas pode ser reaberto com motivo', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const empty = await c.as.doctor.post(`/patients/${c.patientId}/records`, {});
    const emptyFinal = await c.as.doctor.post(`/records/${empty.body.id}/finalize`, {
      version: 1,
    });
    expect(emptyFinal.status).toBe(422);

    const created = await c.as.doctor.post(`/patients/${c.patientId}/records`, {
      content: CONTENT,
    });
    const id = created.body.id;
    expect((await c.as.doctor.post(`/records/${id}/finalize`, { version: 1 })).status).toBe(200);
    const edit = await c.as.doctor.patch(`/records/${id}`, { version: 1, content: {} });
    expect(edit.status).toBe(409);
    expect(errorCode(edit.body)).toBe('INVALID_STATE_TRANSITION');
    expect((await c.as.doctor.post(`/records/${id}/reopen`, {})).status).toBe(400);
    const reopened = await c.as.doctor.post(`/records/${id}/reopen`, { reason: 'Faltou exame' });
    expect(reopened.body.status).toBe('draft');
    // Já foi finalizado uma vez: não pode mais ser descartado.
    expect((await c.as.doctor.post(`/records/${id}/discard`)).status).toBe(409);
    expect((await c.as.doctor.post(`/records/${empty.body.id}/discard`)).status).toBe(200);
    const history = await c.as.doctor.get(`/records/${id}/history`);
    expect(history.body.map((e: { type: string }) => e.type)).toEqual([
      'created',
      'finalized',
      'reopened',
    ]);
    expect(history.body[2].details).toEqual({ reason: 'Faltou exame' });
  });
});

describe('assinatura', () => {
  it('exige reautenticação, grava o resumo e as evidências e informa a integridade', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const created = await c.as.doctor.post(`/patients/${c.patientId}/records`, {
      content: CONTENT,
    });
    const id = created.body.id;
    await c.as.doctor.post(`/records/${id}/finalize`, { version: 1 });
    const noReauth = await c.as.doctor.post(`/records/${id}/sign`, { version: 1 });
    expect(noReauth.status).toBe(403);
    expect(errorCode(noReauth.body)).toBe('REAUTH_REQUIRED');
    await c.as.doctor.reauth(c.doctor, t.clock);
    const wrongVersion = await c.as.doctor.post(`/records/${id}/sign`, { version: 7 });
    expect(wrongVersion.status).toBe(409);
    const signed = await c.as.doctor.post(`/records/${id}/sign`, { version: 1 });
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({ status: 'signed', integrity: 'valid' });
    expect(signed.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const row = await t.db.clinicalRecord.findUniqueOrThrow({ where: { id } });
    expect(row.signatureEvidence).toMatchObject({ method: 'internal_reauth' });
    expect((row.signatureEvidence as { sessionId: string }).sessionId).toBeTruthy();
  });

  it('o registro assinado não muda pela API nem por SQL direto', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const signed = await signedRecord(c);
    const id = signed.id;
    const edit = await c.as.doctor.patch(`/records/${id}`, { version: 1, content: {} });
    expect(edit.status).toBe(409);
    expect((await c.as.doctor.post(`/records/${id}/reopen`, { reason: 'Tentativa' })).status).toBe(
      409,
    );
    await expect(
      t.db
        .$executeRaw`UPDATE records.clinical_records SET content = '{"plan":"alterado"}' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/assinado/);
    await expect(
      t.db.$executeRaw`UPDATE records.clinical_records SET status = 'draft' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/não permitida/);
    await expect(
      t.db.$executeRaw`DELETE FROM records.clinical_records WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/apagado/);
    await expect(
      t.db
        .$executeRaw`UPDATE records.record_versions SET content = '{}' WHERE record_id = ${id}::uuid`,
    ).rejects.toThrow(/somente-acréscimo/);
    await expect(
      t.db.$executeRaw`DELETE FROM records.record_events WHERE record_id = ${id}::uuid`,
    ).rejects.toThrow(/somente-acréscimo/);
    const after = await c.as.doctor.get(`/records/${id}`);
    expect(after.body.content).toEqual(signed.content);
    expect(after.body.integrity).toBe('valid');
  });

  it('se alguém desligar o gatilho e alterar o conteúdo, a integridade aparece inválida', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const signed = await signedRecord(c);
    await t.db.$transaction([
      t.db.$executeRawUnsafe(
        'ALTER TABLE records.clinical_records DISABLE TRIGGER clinical_records_protected',
      ),
      t.db
        .$executeRaw`UPDATE records.clinical_records SET content = '{"plan":"adulterado"}' WHERE id = ${signed.id}::uuid`,
      t.db.$executeRawUnsafe(
        'ALTER TABLE records.clinical_records ENABLE TRIGGER clinical_records_protected',
      ),
    ]);
    const res = await c.as.doctor.get(`/records/${signed.id}`);
    expect(res.body.integrity).toBe('invalid');
  });

  it('só o autor assina', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await startEncounter(c, 'otherDoctor', '10:00');
    const created = await c.as.doctor.post(`/patients/${c.patientId}/records`, {
      content: CONTENT,
    });
    await c.as.doctor.post(`/records/${created.body.id}/finalize`, { version: 1 });
    await c.as.otherDoctor.reauth(c.otherDoctor, t.clock);
    const res = await c.as.otherDoctor.post(`/records/${created.body.id}/sign`, { version: 1 });
    expect(res.status).toBe(403);
  });
});

describe('retificação e adendo', () => {
  it('a retificação assinada substitui o original, e os dois continuam visíveis', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await startEncounter(c, 'otherDoctor', '10:00');
    const original = await signedRecord(c);
    const path = `/records/${original.id}/rectify`;
    expect((await c.as.otherDoctor.post(path, { justification: 'Não sou o autor.' })).status).toBe(
      403,
    );
    expect((await c.as.doctor.post(path, { justification: 'curta' })).status).toBe(400);
    const draft = await c.as.doctor.post(path, { justification: 'Lateralidade errada no exame.' });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({
      status: 'draft',
      rectifiesId: original.id,
      content: original.content,
      clinicalDate: original.clinicalDate,
    });
    const again = await c.as.doctor.post(path, { justification: 'Segunda retificação.' });
    expect(again.status).toBe(409);

    const saved = await c.as.doctor.patch(`/records/${draft.body.id}`, {
      version: 1,
      content: { ...CONTENT, physicalExam: 'Orofaringe hiperemiada à direita.' },
    });
    expect(saved.status).toBe(200);
    // O original só muda de estado quando a retificação é assinada.
    expect((await c.as.doctor.get(`/records/${original.id}`)).body.status).toBe('signed');
    await finalizeAndSign(c, 'doctor', draft.body.id, 2);

    const before = await c.as.doctor.get(`/records/${original.id}`);
    expect(before.body).toMatchObject({
      status: 'rectified',
      rectifiedById: draft.body.id,
      integrity: 'valid',
      content: original.content,
    });
    const timeline = await c.as.otherDoctor.get(`/patients/${c.patientId}/records`);
    expect(timeline.body.map((r: { id: string; status: string }) => [r.id, r.status])).toEqual(
      expect.arrayContaining([
        [original.id, 'rectified'],
        [draft.body.id, 'signed'],
      ]),
    );
    expect((await c.as.doctor.post(path, { justification: 'Já foi retificado.' })).status).toBe(
      409,
    );
  });

  it('com o vínculo expirado, o autor ainda vê e adenda os próprios registros, mas não cria novos', async () => {
    const c = await setupClinic();
    const encounterId = await startEncounter(c, 'doctor', '09:00');
    await startEncounter(c, 'otherDoctor', '10:00');
    const own = await signedRecord(c);
    const others = await signedRecord(c, 'otherDoctor');
    await c.as.doctor.post(`/encounters/${encounterId}/close`, {});
    t.clock.advance(60 * DAY);

    const timeline = await c.as.doctor.get(`/patients/${c.patientId}/records`);
    expect(timeline.body.map((r: { id: string }) => r.id)).toEqual([own.id]);
    expect((await c.as.doctor.get(`/records/${others.id}`)).status).toBe(403);
    expect((await c.as.doctor.post(`/patients/${c.patientId}/records`, {})).status).toBe(403);

    const addendum = await c.as.doctor.post(`/records/${own.id}/addendum`, {
      justification: 'Resultado de exame chegou depois.',
      content: { plan: 'Exame normal, manter conduta.' },
    });
    expect(addendum.status).toBe(201);
    expect(addendum.body).toMatchObject({
      kind: 'addendum',
      addendumOfId: own.id,
      encounterId: null,
    });
    const signed = await finalizeAndSign(c, 'doctor', addendum.body.id, 1);
    expect(signed.status).toBe('signed');
    // Adendo não substitui: o original continua assinado.
    expect((await c.as.doctor.get(`/records/${own.id}`)).body.status).toBe('signed');
    // Retificar ou adendar o registro de outro autor continua negado.
    const foreign = await c.as.doctor.post(`/records/${others.id}/addendum`, {
      justification: 'Tentativa sobre registro alheio.',
    });
    expect(foreign.status).toBe(403);
  });
});

describe('sensibilidade, arquivamento e linha do tempo', () => {
  it('registro sensível de outro autor aparece sem conteúdo e só abre com justificativa gravada', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await startEncounter(c, 'otherDoctor', '10:00');
    const sensitive = await signedRecord(c, 'otherDoctor', { sensitivity: 'elevated' });
    const timeline = await c.as.doctor.get(`/patients/${c.patientId}/records`);
    expect(timeline.body).toEqual([
      expect.objectContaining({ id: sensitive.id, contentHidden: true, content: null }),
    ]);
    const denied = await c.as.doctor.get(`/records/${sensitive.id}`);
    expect(denied.status).toBe(403);
    const reason = 'Avaliar interação medicamentosa antes de prescrever.';
    const opened = await c.as.doctor.get(
      `/records/${sensitive.id}?justification=${encodeURIComponent(reason)}`,
    );
    expect(opened.status).toBe(200);
    expect(opened.body.content).toEqual(sensitive.content);
    const stored = await t.db.accessJustification.findMany({ where: { recordId: sensitive.id } });
    expect(stored).toMatchObject([{ userId: c.doctor.id, justification: reason }]);
    const audited = await t.db.auditEvent.count({
      where: { resourceId: sensitive.id, reason: 'sensitive_access_justified' },
    });
    expect(audited).toBe(1);
    // O próprio autor abre sem justificativa.
    expect((await c.as.otherDoctor.get(`/records/${sensitive.id}`)).status).toBe(200);
  });

  it('arquivados saem da linha do tempo, a menos que sejam pedidos', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const signed = await signedRecord(c);
    const draft = await c.as.doctor.post(`/patients/${c.patientId}/records`, {
      clinicalDate: '2026-03-01',
    });
    expect((await c.as.doctor.post(`/records/${draft.body.id}/archive`)).status).toBe(409);
    const archived = await c.as.doctor.post(`/records/${signed.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ status: 'archived', integrity: 'valid' });
    const path = `/patients/${c.patientId}/records`;
    expect((await c.as.doctor.get(path)).body.map((r: { id: string }) => r.id)).toEqual([
      draft.body.id,
    ]);
    const all = await c.as.doctor.get(`${path}?includeArchived=true`);
    expect(all.body.map((r: { id: string }) => r.id)).toEqual([signed.id, draft.body.id]);
  });
});

describe('cópia do prontuário pedida pelo paciente', () => {
  const PRESCRIPTION = {
    kind: 'prescription',
    content: {
      items: [
        {
          medication: 'Dipirona 500 mg (dado fictício)',
          instructions: 'Tomar 1 comprimido se dor.',
          quantity: '1 caixa',
        },
      ],
    },
  };

  it('o médico com vínculo gera a cópia do que pode ler, sem sensíveis de outros nem rascunhos', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'otherDoctor', '10:00');
    const othersNormal = await signedRecord(c, 'otherDoctor');
    const othersSensitive = await signedRecord(c, 'otherDoctor', { sensitivity: 'elevated' });
    await startEncounter(c, 'doctor', '09:00');
    const own = await signedRecord(c, 'doctor', { sensitivity: 'elevated' });
    const draft = await c.as.doctor.post(`/patients/${c.patientId}/records`, { content: CONTENT });
    expect(draft.status).toBe(201);
    const doc = await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION);
    expect(doc.status).toBe(201);
    const signedDoc = await c.as.doctor.post(`/documents/${doc.body.id}/sign`, {
      version: doc.body.version,
    });
    expect(signedDoc.status).toBe(200);

    await c.as.doctor.reauth(c.doctor, t.clock);
    const res = await c.as.doctor.get(`/patients/${c.patientId}/clinical-copy`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="copia-do-prontuario-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(res.body).toMatchObject({
      format: 'crm-medico/copia-do-prontuario',
      version: 1,
      generatedBy: { id: c.doctor.id },
      organization: { name: 'Clínica Fictícia' },
      patient: { id: c.patientId },
      withheld: { records: 1, documents: 0 },
    });
    const ids = (res.body.records as { id: string }[]).map((r) => r.id).sort();
    expect(ids).toEqual([othersNormal.id, own.id].sort());
    expect(ids).not.toContain(othersSensitive.id);
    expect(ids).not.toContain(draft.body.id);
    expect(res.body.records[0]).toMatchObject({ status: 'signed', integrity: 'valid' });
    expect((res.body.documents as { id: string }[]).map((d) => d.id)).toEqual([doc.body.id]);
    expect(res.body.withheld.reason).toMatch(/sensíveis de outros profissionais/);

    const event = await t.db.auditEvent.findFirstOrThrow({
      where: { action: 'export', resourceType: 'clinical_record', patientId: c.patientId },
    });
    expect(event).toMatchObject({ outcome: 'allowed', actorUserId: c.doctor.id });
  });

  it('exige reautenticação recente', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await signedRecord(c);
    t.clock.advance(10 * 60_000);
    const res = await c.as.doctor.get(`/patients/${c.patientId}/clinical-copy`);
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe('REAUTH_REQUIRED');
  });

  it('nega a secretária, o administrador e o médico sem vínculo; paciente inexistente é 404', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await signedRecord(c);
    await c.as.otherDoctor.reauth(c.otherDoctor, t.clock);
    const denied = await c.as.otherDoctor.get(`/patients/${c.patientId}/clinical-copy`);
    expect(denied.status).toBe(403);
    expect(errorCode(denied.body)).toBe('FORBIDDEN');
    for (const who of ['secretary', 'admin'] as const) {
      const res = await c.as[who].get(`/patients/${c.patientId}/clinical-copy`);
      expect(res.status, who).toBe(403);
    }
    await c.as.doctor.reauth(c.doctor, t.clock);
    const missing = await c.as.doctor.get(
      '/patients/00000000-0000-4000-8000-000000000000/clinical-copy',
    );
    expect(missing.status).toBe(404);
  });
});
