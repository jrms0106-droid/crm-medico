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

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await resetData(t.db);
});

const errorCode = (body: unknown) => errorResponseSchema.parse(body).error.code;

// CPFs fictícios com dígitos verificadores válidos.
const CPF_A = '529.982.247-25';
const CPF_B = '111.444.777-35';

interface Clinic {
  organizationId: string;
  secretary: TestUser;
  as: { admin: Client; doctor: Client; secretary: Client };
}

async function setupClinic(): Promise<Clinic> {
  const org = await t.db.organization.create({ data: { name: 'Clínica Fictícia' } });
  const unit = await createUnit(t.db, org.id);
  const base = { organizationId: org.id, unitIds: [unit.id] };
  const admin = await createUser(t.db, ['admin'], base);
  const doctor = await createUser(t.db, ['doctor'], base);
  const secretary = await createUser(t.db, ['secretary'], base);
  const login = async (user: TestUser) => {
    const client = new Client(t.app);
    await client.loginFully(user, t.clock);
    return client;
  };
  return {
    organizationId: org.id,
    secretary,
    as: {
      admin: await login(admin),
      doctor: await login(doctor),
      secretary: await login(secretary),
    },
  };
}

/** Paciente adulto fictício; o relógio de teste está em março de 2026. */
function patient(extra: Record<string, unknown> = {}) {
  return {
    fullName: 'José da Silva',
    birthDate: '1980-05-20',
    phones: [{ number: '(11) 98765-4321', whatsapp: true }],
    ...extra,
  };
}

async function lastAudit() {
  return t.db.auditEvent.findFirstOrThrow({ orderBy: { seq: 'desc' } });
}

describe('criação do cadastro', () => {
  it('secretária cadastra paciente completo; o CPF fica criptografado no banco', async () => {
    const c = await setupClinic();
    const res = await c.as.secretary.post(
      '/patients',
      patient({
        socialName: 'Zeca',
        cpf: CPF_A,
        email: 'Jose@Exemplo-Ficticio.test',
        address: {
          zip: '01310-100',
          street: 'Avenida Fictícia',
          number: '1000',
          district: 'Centro',
          city: 'São Paulo',
          state: 'sp',
        },
        emergencyContacts: [{ name: 'Ana da Silva', relationship: 'Irmã', phone: '11912345678' }],
        communication: {
          channels: ['whatsapp', 'email'],
          appointmentReminders: true,
          marketing: false,
        },
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      displayName: 'Zeca',
      fullName: 'José da Silva',
      cpf: CPF_A,
      email: 'jose@exemplo-ficticio.test',
      phones: [{ number: '11987654321', whatsapp: true }],
      address: { zip: '01310100', state: 'SP', complement: null },
      emergencyContacts: [{ name: 'Ana da Silva', relationship: 'Irmã', phone: '11912345678' }],
      communication: {
        channels: ['whatsapp', 'email'],
        appointmentReminders: true,
        marketing: false,
      },
      version: 1,
      active: true,
    });

    const row = await t.db.patient.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.cpfEnc).not.toContain('52998224725');
    expect(row.cpfHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await lastAudit()).toMatchObject({
      action: 'create',
      patientId: res.body.id,
      outcome: 'allowed',
      reason: 'patient_created',
    });
  });

  it('CPF inválido é recusado campo a campo', async () => {
    const c = await setupClinic();
    const res = await c.as.secretary.post('/patients', patient({ cpf: '123.456.789-00' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'cpf', issue: 'CPF inválido.' }]);
  });

  it('CPF repetido é bloqueado, mesmo com outro nome e com o primeiro cadastro inativo', async () => {
    const c = await setupClinic();
    const first = await c.as.secretary.post('/patients', patient({ cpf: CPF_A }));
    await c.as.secretary.patch(`/patients/${first.body.id}`, { version: 1, active: false });
    const res = await c.as.secretary.post(
      '/patients',
      patient({
        fullName: 'Outra Pessoa',
        birthDate: '1990-01-01',
        cpf: '52998224725',
        phones: [{ number: '1132345678' }],
      }),
    );
    expect(res.status).toBe(409);
    expect(errorCode(res.body)).toBe('CPF_ALREADY_REGISTERED');
  });

  it('dois cadastros simultâneos com o mesmo CPF: só um é gravado', async () => {
    const c = await setupClinic();
    const body = (name: string, phone: string) =>
      patient({
        fullName: name,
        cpf: CPF_B,
        phones: [{ number: phone }],
        allowPossibleDuplicate: true,
      });
    const results = await Promise.all([
      c.as.secretary.post('/patients', body('Pessoa Um', '11911111111')),
      c.as.doctor.post('/patients', body('Pessoa Dois', '11922222222')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await t.db.patient.count()).toBe(1);
  });

  it('alerta de possível duplicidade por nome parecido e mesma data, ou mesmo telefone', async () => {
    const c = await setupClinic();
    const first = await c.as.secretary.post('/patients', patient());

    const sameName = await c.as.secretary.post(
      '/patients',
      patient({ fullName: 'Jose Silva', phones: [{ number: '11955555555' }] }),
    );
    expect(sameName.status).toBe(409);
    expect(errorCode(sameName.body)).toBe('POSSIBLE_DUPLICATE');
    expect(sameName.body.error.details).toEqual([{ field: 'candidateId', issue: first.body.id }]);

    const samePhone = await c.as.secretary.post(
      '/patients',
      patient({ fullName: 'Carlos Andrade', birthDate: '1975-01-01' }),
    );
    expect(errorCode(samePhone.body)).toBe('POSSIBLE_DUPLICATE');

    const check = await c.as.secretary.post('/patients/duplicate-check', {
      fullName: 'josé silva',
      birthDate: '1980-05-20',
    });
    expect(check.body.map((p: { id: string }) => p.id)).toEqual([first.body.id]);

    const confirmed = await c.as.secretary.post(
      '/patients',
      patient({
        fullName: 'Jose Silva',
        phones: [{ number: '11955555555' }],
        allowPossibleDuplicate: true,
      }),
    );
    expect(confirmed.status).toBe(201);
    expect((await lastAudit()).reason).toBe('patient_created_despite_duplicate_alert');

    const homonymOtherDate = await c.as.secretary.post(
      '/patients',
      patient({ birthDate: '1991-02-02', phones: [{ number: '11966666666' }] }),
    );
    expect(homonymOtherDate.status).toBe(201);
  });

  it('menor de 18 anos precisa de responsável; data futura é recusada', async () => {
    const c = await setupClinic();
    const child = {
      fullName: 'Lucas Pereira',
      birthDate: '2015-08-10',
      phones: [{ number: '11977777777' }],
    };
    const noGuardian = await c.as.secretary.post('/patients', child);
    expect(noGuardian.status).toBe(422);
    const withGuardian = await c.as.secretary.post('/patients', {
      ...child,
      guardians: [{ name: 'Paula Pereira', relationship: 'Mãe', phone: '11977777777' }],
    });
    expect(withGuardian.status).toBe(201);
    expect(withGuardian.body.guardians).toEqual([
      { name: 'Paula Pereira', relationship: 'Mãe', phone: '11977777777', email: null },
    ]);

    const future = await c.as.secretary.post(
      '/patients',
      patient({ birthDate: '2030-01-01', phones: [{ number: '11988888888' }] }),
    );
    expect(future.status).toBe(400);
  });

  it('canal de comunicação sem o contato correspondente é recusado', async () => {
    const c = await setupClinic();
    const res = await c.as.secretary.post(
      '/patients',
      patient({
        communication: { channels: ['email'], appointmentReminders: true, marketing: false },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('busca', () => {
  it('encontra "José" digitando "jose", por partes do nome, nome social, CPF e telefone', async () => {
    const c = await setupClinic();
    const jose = await c.as.secretary.post('/patients', patient({ cpf: CPF_A }));
    const maria = await c.as.secretary.post('/patients', {
      fullName: 'Maria da Silva',
      socialName: 'Mel Conceição',
      birthDate: '1990-03-03',
      phones: [{ number: '2133334444' }],
    });
    const ids = async (q: string) => {
      const res = await c.as.secretary.get(`/patients?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
      return res.body.map((p: { id: string }) => p.id);
    };

    expect(await ids('jose')).toEqual([jose.body.id]);
    expect(await ids('JOSÉ SILVA')).toEqual([jose.body.id]);
    expect(await ids('silva')).toEqual([jose.body.id, maria.body.id]);
    expect(await ids('maria silva')).toEqual([maria.body.id]);
    expect(await ids('conceicao')).toEqual([maria.body.id]);
    expect(await ids(CPF_A)).toEqual([jose.body.id]);
    expect(await ids('52998224725')).toEqual([jose.body.id]);
    expect(await ids('(21) 3333')).toEqual([maria.body.id]);
    expect(await ids('8765-4321')).toEqual([jose.body.id]);
    expect(await ids('ninguem')).toEqual([]);

    const summary = (await c.as.secretary.get('/patients?q=jose')).body[0];
    expect(summary).toEqual({
      id: jose.body.id,
      displayName: 'José da Silva',
      fullName: 'José da Silva',
      socialName: null,
      birthDate: '1980-05-20',
      cpfMasked: '***.982.247-**',
      primaryPhone: '11987654321',
      active: true,
    });
    expect((await c.as.secretary.get('/patients?q=mel')).body[0].displayName).toBe('Mel Conceição');
  });

  it('inativos só aparecem quando pedidos; busca curta é recusada', async () => {
    const c = await setupClinic();
    const p = await c.as.secretary.post('/patients', patient());
    await c.as.secretary.patch(`/patients/${p.body.id}`, { version: 1, active: false });
    expect((await c.as.secretary.get('/patients?q=jose')).body).toEqual([]);
    expect((await c.as.secretary.get('/patients?q=jose&includeInactive=true')).body).toHaveLength(
      1,
    );
    expect((await c.as.secretary.get('/patients?q=j')).status).toBe(400);
  });
});

describe('alterações e histórico', () => {
  it('toda alteração gera versão, com quem, quando e o que mudou, sem guardar o CPF', async () => {
    const c = await setupClinic();
    const created = await c.as.secretary.post('/patients', patient({ cpf: CPF_A }));
    const id = created.body.id;

    const updated = await c.as.secretary.patch(`/patients/${id}`, {
      version: 1,
      socialName: 'Zeca',
      phones: [{ number: '11987654321', whatsapp: true }, { number: '1132345678' }],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.version).toBe(2);
    expect(updated.body.displayName).toBe('Zeca');
    expect(await lastAudit()).toMatchObject({ action: 'edit', patientId: id, outcome: 'allowed' });

    const cpfChange = await c.as.secretary.patch(`/patients/${id}`, { version: 2, cpf: CPF_B });
    expect(cpfChange.body.cpf).toBe(CPF_B);

    const history = await c.as.doctor.get(`/patients/${id}/history`);
    expect(history.status).toBe(200);
    expect(history.body.map((v: { version: number }) => v.version)).toEqual([3, 2, 1]);
    expect(history.body.map((v: { changedFields: string[] }) => v.changedFields)).toEqual([
      ['cpf'],
      ['socialName', 'phones'],
      ['created'],
    ]);
    expect(history.body[1].changedBy.id).toBe(c.secretary.id);
    expect(history.body[1].snapshot.displayName).toBe('Zeca');
    expect(history.body[1].snapshot.hasCpf).toBe(true);
    expect(JSON.stringify(history.body)).not.toMatch(/52998224725|529\.982|11144477735|111\.444/);
  });

  it('salvar sobre versão desatualizada devolve 409 e não grava nada', async () => {
    const c = await setupClinic();
    const created = await c.as.secretary.post('/patients', patient());
    const id = created.body.id;
    await c.as.secretary.patch(`/patients/${id}`, {
      version: 1,
      email: 'novo@exemplo-ficticio.test',
    });
    const stale = await c.as.doctor.patch(`/patients/${id}`, {
      version: 1,
      fullName: 'José Souza',
    });
    expect(stale.status).toBe(409);
    expect(errorCode(stale.body)).toBe('VERSION_CONFLICT');
    const current = await c.as.secretary.get(`/patients/${id}`);
    expect(current.body).toMatchObject({ fullName: 'José da Silva', version: 2 });
  });

  it('duas edições simultâneas da mesma versão: só uma vence', async () => {
    const c = await setupClinic();
    const created = await c.as.secretary.post('/patients', patient());
    const id = created.body.id;
    const results = await Promise.all([
      c.as.secretary.patch(`/patients/${id}`, { version: 1, fullName: 'José Primeiro' }),
      c.as.doctor.patch(`/patients/${id}`, { version: 1, fullName: 'José Segundo' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await t.db.patientVersion.count({ where: { patientId: id } })).toBe(2);
  });

  it('enviar os mesmos valores não cria versão nova', async () => {
    const c = await setupClinic();
    const created = await c.as.secretary.post('/patients', patient());
    const same = await c.as.secretary.patch(`/patients/${created.body.id}`, {
      version: 1,
      fullName: 'José da Silva',
    });
    expect(same.status).toBe(200);
    expect(same.body.version).toBe(1);
  });

  it('versões não podem ser alteradas nem apagadas, nem por SQL direto', async () => {
    const c = await setupClinic();
    await c.as.secretary.post('/patients', patient());
    await expect(
      t.db.$executeRawUnsafe(`UPDATE patients.versions SET version = 99`),
    ).rejects.toThrow(/apenas inclusão/);
    await expect(t.db.$executeRawUnsafe(`DELETE FROM patients.versions`)).rejects.toThrow(
      /apenas inclusão/,
    );
  });
});

describe('permissões', () => {
  it('administrador não acessa cadastro de pacientes, e cada negação fica auditada', async () => {
    const c = await setupClinic();
    const p = await c.as.secretary.post('/patients', patient());
    const id = p.body.id;
    const calls = [
      () => c.as.admin.get('/patients?q=jose'),
      () => c.as.admin.get(`/patients/${id}`),
      () => c.as.admin.get(`/patients/${id}/history`),
      () => c.as.admin.post('/patients', patient({ phones: [{ number: '11900000000' }] })),
      () =>
        c.as.admin.post('/patients/duplicate-check', { fullName: 'José', birthDate: '1980-05-20' }),
      () => c.as.admin.patch(`/patients/${id}`, { version: 1, fullName: 'Invasão' }),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(403);
      expect(await lastAudit()).toMatchObject({
        outcome: 'denied',
        resourceType: 'patient_registration',
      });
    }
    expect((await lastAudit()).patientId).toBe(id);
    expect(await t.db.patient.count()).toBe(1);
  });

  it('médico e secretária veem e editam; a ficha não traz nenhum dado clínico', async () => {
    const c = await setupClinic();
    const p = await c.as.doctor.post('/patients', patient());
    expect(p.status).toBe(201);
    const seen = await c.as.secretary.get(`/patients/${p.body.id}`);
    expect(seen.status).toBe(200);
    expect(Object.keys(seen.body).sort()).toEqual(
      [
        'id',
        'displayName',
        'fullName',
        'socialName',
        'cpf',
        'birthDate',
        'email',
        'phones',
        'address',
        'guardians',
        'emergencyContacts',
        'communication',
        'active',
        'version',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(await lastAudit()).toMatchObject({
      action: 'view',
      patientId: p.body.id,
      outcome: 'allowed',
    });
  });

  it('paciente de outra organização ou inexistente dá 404 auditado', async () => {
    const c = await setupClinic();
    const other = await setupClinic();
    const foreign = await other.as.secretary.post('/patients', patient());
    for (const path of [
      `/patients/${foreign.body.id}`,
      '/patients/01920000-0000-7000-8000-00000000abcd',
    ]) {
      const res = await c.as.secretary.get(path);
      expect(res.status).toBe(404);
      expect(await lastAudit()).toMatchObject({
        outcome: 'not_found',
        reason: 'not_found_in_scope',
      });
    }
    const edit = await c.as.secretary.patch(`/patients/${foreign.body.id}`, {
      version: 1,
      fullName: 'Invasão',
    });
    expect(edit.status).toBe(404);
    expect((await other.as.secretary.get(`/patients/${foreign.body.id}`)).body.fullName).toBe(
      'José da Silva',
    );
    const search = await c.as.secretary.get('/patients?q=jose');
    expect(search.body).toEqual([]);
  });
});
