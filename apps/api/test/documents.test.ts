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
const tue = (hhmm: string) => `2026-03-03T${hhmm}:00-03:00`;

const PRESCRIPTION = {
  kind: 'prescription',
  content: {
    items: [
      {
        medication: 'Paracetamol 750 mg (dado fictício)',
        instructions: 'Tomar 1 comprimido a cada 8 horas, se dor ou febre.',
        quantity: '1 caixa',
      },
    ],
    notes: 'Retornar se piorar.',
  },
};

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

async function signedDocument(
  c: Clinic,
  who: 'doctor' | 'otherDoctor' = 'doctor',
  input: object = PRESCRIPTION,
) {
  const created = await c.as[who].post(`/patients/${c.patientId}/documents`, input);
  expect(created.status).toBe(201);
  await c.as[who].reauth(c[who], t.clock);
  const signed = await c.as[who].post(`/documents/${created.body.id}/sign`, {
    version: created.body.version,
  });
  expect(signed.status).toBe(200);
  return signed.body;
}

/** Baixa o PDF como bytes. */
async function pdf(client: Client, id: string) {
  return client
    .get(`/documents/${id}/pdf`)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
}

describe('criação, conteúdo e acesso', () => {
  it('o médico com atendimento iniciado cria o rascunho, ligado ao atendimento', async () => {
    const c = await setupClinic();
    const encounterId = await startEncounter(c, 'doctor', '09:00');
    const res = await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: 'prescription',
      status: 'draft',
      version: 1,
      encounterId,
      snapshot: null,
      issuedOn: null,
      contentHash: null,
      integrity: null,
      author: { id: c.doctor.id },
    });
    const list = await c.as.doctor.get(`/patients/${c.patientId}/documents`);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject([{ id: res.body.id, status: 'draft' }]);
  });

  it('confere o conteúdo de cada tipo', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const path = `/patients/${c.patientId}/documents`;
    const valid = [
      PRESCRIPTION,
      { kind: 'certificate', content: { purpose: 'absence', days: 2, startDate: '2026-03-03' } },
      { kind: 'certificate', content: { purpose: 'attendance' } },
      {
        kind: 'certificate',
        content: { purpose: 'absence', days: 1, icd10: 'j06.9', icd10Authorized: true },
      },
      { kind: 'exam_request', content: { items: [{ exam: 'Hemograma completo' }] } },
      { kind: 'referral', content: { toSpecialty: 'Cardiologia', reason: 'Sopro a investigar.' } },
      { kind: 'report', content: { title: 'Relatório', body: 'Texto fictício.' } },
    ];
    for (const input of valid) {
      const res = await c.as.doctor.post(path, input);
      expect(res.status, JSON.stringify(input)).toBe(201);
    }
    const invalid = [
      { kind: 'prescription', content: { items: [] } },
      { kind: 'certificate', content: { purpose: 'absence' } },
      { kind: 'certificate', content: { purpose: 'attendance', days: 3 } },
      // CID no atestado só com a autorização do paciente.
      { kind: 'certificate', content: { purpose: 'absence', days: 1, icd10: 'J06.9' } },
      { kind: 'exam_request', content: { items: [{ exam: 'Hemograma' }], icd10: 'XYZ' } },
      { kind: 'referral', content: { toSpecialty: '', reason: 'x' } },
      { kind: 'report', content: { title: 'Sem texto' } },
      { kind: 'receita_controlada', content: {} },
      { kind: 'report', content: { title: 'x', body: 'y', extra: true } },
    ];
    for (const input of invalid) {
      const res = await c.as.doctor.post(path, input);
      expect(res.status, JSON.stringify(input)).toBe(400);
      expect(errorCode(res.body)).toBe('VALIDATION_FAILED');
    }
  });

  it('secretária, administrador e médico sem vínculo não criam, não leem e não geram PDF', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const signed = await signedDocument(c);
    const path = `/patients/${c.patientId}/documents`;
    for (const client of [c.as.secretary, c.as.admin, c.as.otherDoctor]) {
      expect((await client.post(path, PRESCRIPTION)).status).toBe(403);
      expect((await client.get(`/documents/${signed.id}`)).status).toBe(403);
      expect((await client.get(`/documents/${signed.id}/history`)).status).toBe(403);
      expect((await client.get(`/documents/${signed.id}/pdf`)).status).toBe(403);
      expect(
        (await client.post(`/documents/${signed.id}/cancel`, { reason: 'Tentativa indevida.' }))
          .status,
      ).toBe(403);
    }
    expect((await c.as.secretary.get(path)).status).toBe(403);
    expect((await c.as.admin.get(path)).status).toBe(403);
    // O médico sem vínculo só vê os documentos dele (nenhum).
    const other = await c.as.otherDoctor.get(path);
    expect(other.status).toBe(200);
    expect(other.body).toEqual([]);
    const denied = await t.db.auditEvent.count({
      where: { resourceType: 'medical_document', outcome: 'denied' },
    });
    expect(denied).toBeGreaterThanOrEqual(17);
  });

  it('agendamento não libera documentos, e paciente inexistente responde 404', async () => {
    const c = await setupClinic();
    await c.as.secretary.post('/appointments', {
      scheduleId: schedules.doctor,
      patientId: c.patientId,
      startsAt: tue('09:00'),
    });
    const res = await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION);
    expect(res.status).toBe(403);
    const missing = '00000000-0000-7000-8000-000000000000';
    expect((await c.as.doctor.post(`/patients/${missing}/documents`, PRESCRIPTION)).status).toBe(
      404,
    );
    expect((await c.as.doctor.get(`/documents/${missing}`)).status).toBe(404);
  });

  it('médico sem registro profissional não cria documento', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await t.db.professional.updateMany({ where: { userId: c.doctor.id }, data: { active: false } });
    const res = await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION);
    expect(res.status).toBe(422);
    expect(errorCode(res.body)).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('rascunho de outro autor não existe para os colegas', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await startEncounter(c, 'otherDoctor', '10:00');
    const draft = await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION);
    expect((await c.as.otherDoctor.get(`/documents/${draft.body.id}`)).status).toBe(404);
    expect((await c.as.otherDoctor.get(`/documents/${draft.body.id}/pdf`)).status).toBe(404);
    const list = await c.as.otherDoctor.get(`/patients/${c.patientId}/documents`);
    expect(list.body).toEqual([]);
  });
});

describe('rascunho, assinatura e cancelamento', () => {
  it('grava o rascunho com controle de versão e confere o conteúdo pelo tipo gravado', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const created = await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION);
    const id = created.body.id;
    const content = { ...PRESCRIPTION.content, notes: 'Nova observação.' };
    const saved = await c.as.doctor.patch(`/documents/${id}`, { version: 1, content });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ version: 2, content: { notes: 'Nova observação.' } });
    const stale = await c.as.doctor.patch(`/documents/${id}`, { version: 1, content });
    expect(stale.status).toBe(409);
    expect(errorCode(stale.body)).toBe('VERSION_CONFLICT');
    // Conteúdo de outro tipo é recusado.
    const wrong = await c.as.doctor.patch(`/documents/${id}`, {
      version: 2,
      content: { title: 'x', body: 'y' },
    });
    expect(wrong.status).toBe(400);
  });

  it('assina com reautenticação, congela o retrato e calcula o resumo', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const created = await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION);
    const id = created.body.id;
    t.clock.advance(20 * 60_000);
    const noReauth = await c.as.doctor.post(`/documents/${id}/sign`, { version: 1 });
    expect(noReauth.status).toBe(403);
    expect(errorCode(noReauth.body)).toBe('REAUTH_REQUIRED');
    await c.as.doctor.reauth(c.doctor, t.clock);
    const signed = await c.as.doctor.post(`/documents/${id}/sign`, { version: 1 });
    expect(signed.status).toBe(200);
    expect(signed.body).toMatchObject({
      status: 'signed',
      issuedOn: '2026-03-03',
      integrity: 'valid',
      snapshot: {
        issuer: {
          name: expect.stringMatching(/^Usuário Fictício/),
          crm: 'CRM/SP 111111',
          specialties: [{ name: 'Clínica Médica', rqe: '12345' }],
        },
        patient: {
          fullName: 'Paciente Fictícia',
          socialName: 'Nome Social Fictício',
          birthDate: '1980-05-20',
        },
        place: { organization: 'Clínica Fictícia', unit: 'Unidade Centro' },
      },
    });
    expect(signed.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // Repetir a assinatura não duplica nada.
    const again = await c.as.doctor.post(`/documents/${id}/sign`, { version: 1 });
    expect(again.status).toBe(409);
    expect((await c.as.doctor.patch(`/documents/${id}`, { version: 1, content: {} })).status).toBe(
      409,
    );
    expect((await c.as.doctor.post(`/documents/${id}/discard`)).status).toBe(409);
    const history = await c.as.doctor.get(`/documents/${id}/history`);
    expect(history.body.map((e: { type: string }) => e.type)).toEqual(['created', 'signed']);
  });

  it('o banco recusa alterar ou apagar o documento assinado', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const signed = await signedDocument(c);
    const id = signed.id;
    await expect(
      t.db
        .$executeRaw`UPDATE documents.medical_documents SET content = '{"items":[]}' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/assinado/);
    await expect(
      t.db
        .$executeRaw`UPDATE documents.medical_documents SET status = 'draft' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/não permitida/);
    await expect(
      t.db.$executeRaw`DELETE FROM documents.medical_documents WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/apagado/);
    await expect(
      t.db.$executeRaw`DELETE FROM documents.document_events WHERE document_id = ${id}::uuid`,
    ).rejects.toThrow(/somente-acréscimo/);
    // Cancelar sem motivo também é barrado pelo banco.
    await expect(
      t.db
        .$executeRaw`UPDATE documents.medical_documents SET status = 'cancelled' WHERE id = ${id}::uuid`,
    ).rejects.toThrow(/cancel_coherent/);
    const after = await c.as.doctor.get(`/documents/${id}`);
    expect(after.body.integrity).toBe('valid');
  });

  it('se alguém desligar o gatilho e alterar o conteúdo, a integridade aparece inválida', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const signed = await signedDocument(c);
    await t.db.$transaction([
      t.db.$executeRawUnsafe(
        'ALTER TABLE documents.medical_documents DISABLE TRIGGER medical_documents_protected',
      ),
      t.db
        .$executeRaw`UPDATE documents.medical_documents SET content = jsonb_set(content, '{notes}', '"adulterado"') WHERE id = ${signed.id}::uuid`,
      t.db.$executeRawUnsafe(
        'ALTER TABLE documents.medical_documents ENABLE TRIGGER medical_documents_protected',
      ),
    ]);
    const res = await c.as.doctor.get(`/documents/${signed.id}`);
    expect(res.body.integrity).toBe('invalid');
  });

  it('só o autor edita, assina, descarta e cancela', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    await startEncounter(c, 'otherDoctor', '10:00');
    const signed = await signedDocument(c);
    const res = await c.as.otherDoctor.post(`/documents/${signed.id}/cancel`, {
      reason: 'Tentativa sobre documento alheio.',
    });
    expect(res.status).toBe(403);
    // O colega com vínculo vê e gera o PDF do assinado.
    expect((await c.as.otherDoctor.get(`/documents/${signed.id}`)).status).toBe(200);
    expect((await pdf(c.as.otherDoctor, signed.id)).status).toBe(200);
    const audit = await t.db.auditEvent.findFirst({
      where: { resourceId: signed.id, action: 'correct', outcome: 'denied' },
    });
    expect(audit?.reason).toBe('not_author');
  });

  it('o autor cancela o assinado com motivo; o documento continua visível', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const signed = await signedDocument(c);
    const short = await c.as.doctor.post(`/documents/${signed.id}/cancel`, { reason: 'Erro' });
    expect(short.status).toBe(400);
    const reason = 'Emitido com a posologia errada.';
    const cancelled = await c.as.doctor.post(`/documents/${signed.id}/cancel`, { reason });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      cancelReason: reason,
      integrity: 'valid',
    });
    const again = await c.as.doctor.post(`/documents/${signed.id}/cancel`, { reason });
    expect(again.status).toBe(409);
    const list = await c.as.doctor.get(`/patients/${c.patientId}/documents`);
    expect(list.body).toMatchObject([{ id: signed.id, status: 'cancelled' }]);
    await expect(
      t.db
        .$executeRaw`UPDATE documents.medical_documents SET cancel_reason = 'outro' WHERE id = ${signed.id}::uuid`,
    ).rejects.toThrow(/cancelado/);
  });

  it('descarta o rascunho, que some da lista', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const created = await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION);
    const res = await c.as.doctor.post(`/documents/${created.body.id}/discard`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('discarded');
    expect((await c.as.doctor.get(`/patients/${c.patientId}/documents`)).body).toEqual([]);
    expect((await c.as.doctor.get(`/documents/${created.body.id}/pdf`)).status).toBe(409);
  });
});

describe('vínculo encerrado e expirado', () => {
  it('encerrado: assina o rascunho pendente, mas não cria documento novo', async () => {
    const c = await setupClinic();
    const encounterId = await startEncounter(c, 'doctor', '09:00');
    const draft = await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION);
    await c.as.doctor.post(`/encounters/${encounterId}/close`, {});
    expect(
      (await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION)).status,
    ).toBe(403);
    await c.as.doctor.reauth(c.doctor, t.clock);
    const signed = await c.as.doctor.post(`/documents/${draft.body.id}/sign`, { version: 1 });
    expect(signed.status).toBe(200);
  });

  it('expirado: o autor ainda vê, cancela e gera o PDF dos próprios; os alheios, não', async () => {
    const c = await setupClinic();
    const encounterId = await startEncounter(c, 'doctor', '09:00');
    await startEncounter(c, 'otherDoctor', '10:00');
    const own = await signedDocument(c);
    const others = await signedDocument(c, 'otherDoctor');
    await c.as.doctor.post(`/encounters/${encounterId}/close`, {});
    t.clock.advance(60 * DAY);
    const list = await c.as.doctor.get(`/patients/${c.patientId}/documents`);
    expect(list.body.map((d: { id: string }) => d.id)).toEqual([own.id]);
    expect((await c.as.doctor.get(`/documents/${others.id}`)).status).toBe(403);
    expect((await c.as.doctor.get(`/documents/${others.id}/pdf`)).status).toBe(403);
    expect((await pdf(c.as.doctor, own.id)).status).toBe(200);
    expect(
      (await c.as.doctor.post(`/patients/${c.patientId}/documents`, PRESCRIPTION)).status,
    ).toBe(403);
    const cancelled = await c.as.doctor.post(`/documents/${own.id}/cancel`, {
      reason: 'Cancelado depois do atendimento.',
    });
    expect(cancelled.status).toBe(200);
  });
});

describe('PDF', () => {
  it('gera o PDF do assinado e registra a exportação na auditoria', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const signed = await signedDocument(c, 'doctor', {
      kind: 'certificate',
      content: { purpose: 'absence', days: 2, icd10: 'J06.9', icd10Authorized: true },
    });
    const res = await pdf(c.as.doctor, signed.id);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const bytes = res.body as Buffer;
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
    const exported = await t.db.auditEvent.findFirst({
      where: { resourceId: signed.id, action: 'export', outcome: 'allowed' },
    });
    expect(exported).toMatchObject({ resourceType: 'medical_document', patientId: c.patientId });
  });

  it('gera o PDF de rascunho e de todos os tipos sem erro', async () => {
    const c = await setupClinic();
    await startEncounter(c, 'doctor', '09:00');
    const inputs = [
      PRESCRIPTION,
      { kind: 'certificate', content: { purpose: 'attendance', text: 'Observação fictícia.' } },
      {
        kind: 'exam_request',
        content: {
          items: [{ exam: 'Hemograma completo', notes: 'em jejum' }, { exam: 'Glicemia' }],
          clinicalIndication: 'Rotina (dado fictício).',
          icd10: 'Z00.0',
        },
      },
      {
        kind: 'referral',
        content: { toSpecialty: 'Cardiologia', reason: 'Sopro.', clinicalSummary: 'Resumo.' },
      },
      { kind: 'report', content: { title: 'Relatório', body: 'Texto fictício. '.repeat(400) } },
    ];
    for (const input of inputs) {
      const created = await c.as.doctor.post(`/patients/${c.patientId}/documents`, input);
      const res = await pdf(c.as.doctor, created.body.id);
      expect(res.status, JSON.stringify(input).slice(0, 40)).toBe(200);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
  });
});
