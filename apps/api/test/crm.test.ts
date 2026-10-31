import 'dotenv/config';
import { errorResponseSchema } from '@crm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MessageSender, type OutgoingMessage } from '../src/crm/message-sender.js';
import { RemindersService } from '../src/crm/reminders.service.js';
import {
  Client,
  type TestApp,
  createUnit,
  createUser,
  resetData,
  startTestApp,
} from './helpers.js';

/** Envio de teste: registra o que sairia e pode ser obrigado a falhar. */
class RecordingSender extends MessageSender {
  sent: OutgoingMessage[] = [];
  fail = false;
  send(message: OutgoingMessage): Promise<string> {
    if (this.fail) return Promise.reject(new Error('Serviço indisponível (fictício).'));
    this.sent.push(message);
    return Promise.resolve(`teste-${this.sent.length}`);
  }
}

let t: TestApp;
const sender = new RecordingSender();
let reminders: RemindersService;

// Segunda-feira, 2 de março de 2026, 09:00 em São Paulo (UTC-3).
const NOW = '2026-03-02T12:00:00.000Z';
// Segunda, 15:00 local: a consulta de terça 14:00 fica a 23 horas.
const MONDAY_AFTERNOON = '2026-03-02T18:00:00.000Z';

beforeAll(async () => {
  t = await startTestApp(
    { SESSION_IDLE_MINUTES: '1000000', SESSION_ABSOLUTE_HOURS: '100000' },
    { messageSender: sender },
  );
  reminders = t.app.get(RemindersService);
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await resetData(t.db);
  t.clock.set(NOW);
  sender.sent = [];
  sender.fail = false;
});

const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;

const WANTS_REMINDERS = {
  channels: ['whatsapp'],
  appointmentReminders: true,
  marketing: false,
};

async function setupClinic() {
  const org = await t.db.organization.create({ data: { name: 'Clínica Fictícia' } });
  const unit = await createUnit(t.db, org.id, 'Unidade Centro');
  const otherUnit = await createUnit(t.db, org.id, 'Unidade Sul');
  const admin = await createUser(t.db, ['admin'], { organizationId: org.id, unitIds: [unit.id] });
  const doctor = await createUser(t.db, ['doctor'], { organizationId: org.id, unitIds: [unit.id] });
  const secretary = await createUser(t.db, ['secretary'], {
    organizationId: org.id,
    unitIds: [unit.id],
  });
  const otherSecretary = await createUser(t.db, ['secretary'], {
    organizationId: org.id,
    unitIds: [otherUnit.id],
  });
  const login = async (user: Parameters<Client['loginFully']>[0]) => {
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
  const professional = await t.db.professional.create({
    data: { organizationId: org.id, userId: doctor.id, crmNumber: '123456', crmState: 'SP' },
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
  const patient = async (fullName: string, communication?: object) => {
    const res = await as.secretary.post('/patients', {
      fullName,
      birthDate: '1980-05-20',
      phones: [{ number: '(11) 98765-4321', whatsapp: true }],
      ...(communication ? { communication } : {}),
      allowPossibleDuplicate: true,
    });
    if (res.status !== 201) throw new Error(`Falha ao cadastrar paciente: ${res.status}`);
    return res.body.id as string;
  };
  const book = async (patientId: string, startsAt: string) => {
    const res = await as.secretary.post('/appointments', {
      scheduleId: schedule.id,
      patientId,
      startsAt,
    });
    if (res.status !== 201) throw new Error(`Falha ao marcar: ${res.status}`);
    return res.body.id as string;
  };
  return { as, patient, book };
}

describe('lembretes de consulta', () => {
  it('só quem autorizou recebe, uma vez, com o mínimo de dados; a secretária vê a lista', async () => {
    const c = await setupClinic();
    const maria = await c.patient('Maria Fictícia da Silva', WANTS_REMINDERS);
    const joao = await c.patient('João Sem Autorização');
    await c.book(maria, '2026-03-03T14:30:00-03:00');
    await c.book(joao, '2026-03-03T15:00:00-03:00');

    // A 29 horas da consulta ainda é cedo.
    expect(await reminders.run()).toEqual({ planned: 0, sent: 0, cancelled: 0, failed: 0 });

    t.clock.set(MONDAY_AFTERNOON);
    expect(await reminders.run()).toEqual({ planned: 1, sent: 1, cancelled: 0, failed: 0 });
    expect(sender.sent).toEqual([
      {
        channel: 'whatsapp',
        toNumber: '11987654321',
        body:
          'Olá, Maria. Lembrete: sua consulta é em 03/03/2026 às 14:30, na Unidade Centro. ' +
          'Para remarcar ou cancelar, ligue para a clínica.',
      },
    ]);
    // Rodar de novo não repete o lembrete.
    expect(await reminders.run()).toEqual({ planned: 0, sent: 0, cancelled: 0, failed: 0 });

    const list = await c.as.secretary.get('/crm/messages');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      patient: { id: maria, name: 'Maria Fictícia da Silva' },
      unit: { name: 'Unidade Centro' },
      status: 'sent',
      toNumberMasked: '(••) •••••-4321',
      providerRef: 'teste-1',
      attempts: 1,
    });
    const byPatient = await c.as.secretary.get(`/crm/messages?patientId=${joao}`);
    expect(byPatient.body).toEqual([]);

    // Secretária de outra unidade não vê; médico e administrador são negados.
    expect((await c.as.otherSecretary.get('/crm/messages')).body).toEqual([]);
    for (const who of ['doctor', 'admin'] as const) {
      const res = await c.as[who].get('/crm/messages');
      expect(res.status, who).toBe(403);
      expect(errorCode(res.body)).toBe('FORBIDDEN');
    }
  });

  it('consulta cancelada ou autorização retirada: o lembrete na fila é cancelado', async () => {
    const c = await setupClinic();
    const maria = await c.patient('Maria Fictícia', WANTS_REMINDERS);
    const ana = await c.patient('Ana Fictícia', WANTS_REMINDERS);
    const appt = await c.book(maria, '2026-03-03T14:30:00-03:00');
    await c.book(ana, '2026-03-03T11:00:00-03:00');
    t.clock.set(MONDAY_AFTERNOON);
    expect(await reminders.plan()).toBe(2);

    const cancelled = await c.as.secretary.post(`/appointments/${appt}/cancel`, {
      reason: 'Paciente pediu (fictício).',
      requestedBy: 'patient',
    });
    expect(cancelled.status).toBe(200);
    const current = await c.as.secretary.get(`/patients/${ana}`);
    const patched = await c.as.secretary.patch(`/patients/${ana}`, {
      version: current.body.version,
      communication: { channels: [], appointmentReminders: false, marketing: false },
    });
    expect(patched.status).toBe(200);

    expect(await reminders.dispatch()).toEqual({ sent: 0, cancelled: 2, failed: 0 });
    expect(sender.sent).toEqual([]);
    const rows = await t.db.outboundMessage.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => [r.status, r.cancelReason]).sort()).toEqual([
      ['cancelled', 'A consulta não está mais marcada.'],
      ['cancelled', 'O paciente retirou a autorização.'],
    ]);
  });

  it('falha no envio: tenta 3 vezes e fica como falha', async () => {
    const c = await setupClinic();
    const maria = await c.patient('Maria Fictícia', WANTS_REMINDERS);
    await c.book(maria, '2026-03-03T14:30:00-03:00');
    t.clock.set(MONDAY_AFTERNOON);
    sender.fail = true;
    expect(await reminders.run()).toEqual({ planned: 1, sent: 0, cancelled: 0, failed: 0 });
    expect(await reminders.run()).toEqual({ planned: 0, sent: 0, cancelled: 0, failed: 0 });
    expect(await reminders.run()).toEqual({ planned: 0, sent: 0, cancelled: 0, failed: 1 });
    const row = await t.db.outboundMessage.findFirstOrThrow();
    expect(row).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: 'Serviço indisponível (fictício).',
    });
    // Falhou de vez: não tenta mais, mesmo com o serviço de volta.
    sender.fail = false;
    expect(await reminders.run()).toEqual({ planned: 0, sent: 0, cancelled: 0, failed: 0 });
  });

  it('a secretária cancela um lembrete na fila; os demais perfis e outras unidades não', async () => {
    const c = await setupClinic();
    const maria = await c.patient('Maria Fictícia', WANTS_REMINDERS);
    await c.book(maria, '2026-03-03T14:30:00-03:00');
    t.clock.set(MONDAY_AFTERNOON);
    await reminders.plan();
    const { id } = await t.db.outboundMessage.findFirstOrThrow();

    const doctor = await c.as.doctor.post(`/crm/messages/${id}/cancel`, { reason: 'Teste.' });
    expect(doctor.status).toBe(403);
    const other = await c.as.otherSecretary.post(`/crm/messages/${id}/cancel`, {
      reason: 'Teste.',
    });
    expect(other.status).toBe(404);
    const noReason = await c.as.secretary.post(`/crm/messages/${id}/cancel`, { reason: '' });
    expect(noReason.status).toBe(400);

    const ok = await c.as.secretary.post(`/crm/messages/${id}/cancel`, {
      reason: 'Paciente avisou que vem (fictício).',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Paciente avisou que vem (fictício).',
    });
    expect(ok.body.cancelledBy.name).toBeTruthy();
    const again = await c.as.secretary.post(`/crm/messages/${id}/cancel`, { reason: 'De novo.' });
    expect(again.status).toBe(409);
    expect(await reminders.dispatch()).toEqual({ sent: 0, cancelled: 0, failed: 0 });

    const event = await t.db.auditEvent.findFirst({
      where: { resourceType: 'communication', action: 'edit', outcome: 'allowed' },
    });
    expect(event?.resourceId).toBe(id);
  });

  it('o banco não deixa apagar nem trocar texto ou destinatário', async () => {
    const c = await setupClinic();
    const maria = await c.patient('Maria Fictícia', WANTS_REMINDERS);
    await c.book(maria, '2026-03-03T14:30:00-03:00');
    t.clock.set(MONDAY_AFTERNOON);
    await reminders.run();
    const { id } = await t.db.outboundMessage.findFirstOrThrow();
    await expect(t.db.outboundMessage.delete({ where: { id } })).rejects.toThrow(
      /não pode ser apagada/,
    );
    await expect(
      t.db.outboundMessage.update({ where: { id }, data: { body: 'Outro texto.' } }),
    ).rejects.toThrow(/não podem ser alterados/);
    await expect(
      t.db.outboundMessage.update({ where: { id }, data: { attempts: 2 } }),
    ).rejects.toThrow(/já finalizada/);
  });
});
