import 'dotenv/config';
import { PATIENT_IMPORT_MAX_ROWS, errorResponseSchema } from '@crm/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  createUnit,
  createUser,
  resetData,
  startTestApp,
  type TestApp,
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

async function setupClinic() {
  const org = await t.db.organization.create({ data: { name: 'Clínica Fictícia' } });
  const unit = await createUnit(t.db, org.id);
  const base = { organizationId: org.id, unitIds: [unit.id] };
  const login = async (roles: ('admin' | 'doctor' | 'secretary')[]) => {
    const user = await createUser(t.db, roles, base);
    const client = new Client(t.app);
    await client.loginFully(user, t.clock);
    return { user, client };
  };
  const secretary = await login(['secretary']);
  const doctor = await login(['doctor']);
  const admin = await login(['admin']);
  return { organizationId: org.id, secretary, doctor, admin };
}

const HEADER =
  'nome;cpf;data_nascimento;telefone;telefone_whatsapp;email;cep;logradouro;numero;bairro;cidade;uf;convenio';
const CSV = [
  HEADER,
  // 2: pronta, com endereço
  `Ana Fictícia Lima;${CPF_A};15/04/1985;11987654321;sim;ana@exemplo.invalid;01001000;Praça da Sé;100;Sé;São Paulo;SP;X`,
  // 3: pronta, sem CPF nem endereço
  'Bruno Fictício Reis;;1990-01-02;11912345678;não;;;;;;;;',
  // 4: erros
  'Ca;111.111.111-11;31/02/1990;123;talvez;;01001000;;;;;;',
  // 5: repete a linha 2 pelo CPF
  `Ana F. Lima;${CPF_A};16/04/1985;11900000001;;;;;;;;;`,
  // 6: CPF já cadastrado no sistema
  `Carla Fictícia Melo;${CPF_B};01/01/1970;11900000002;;;;;;;;;`,
  // 7: parecido com cadastro existente (mesmo nome e nascimento)
  'José da Silva;;20/05/1980;11900000003;;;;;;;;;',
].join('\r\n');

async function seedExisting(secretary: Client) {
  for (const body of [
    {
      fullName: 'Carla Melo Existente',
      cpf: CPF_B,
      birthDate: '1960-06-06',
      phones: [{ number: '11955554444', whatsapp: false }],
    },
    {
      fullName: 'José da Silva',
      birthDate: '1980-05-20',
      phones: [{ number: '11955553333', whatsapp: false }],
    },
  ]) {
    const res = await secretary.post('/patients', body);
    expect(res.status).toBe(201);
  }
}

describe('importação de pacientes por planilha', () => {
  it('a conferência aponta erros e duplicidades sem gravar nada', async () => {
    const c = await setupClinic();
    await seedExisting(c.secretary.client);
    const before = await t.db.patient.count();
    const res = await c.secretary.client.post('/patients/import/preview', { csv: CSV });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      committed: false,
      ignoredColumns: ['convenio'],
      totals: { ready: 2, error: 1, duplicate: 3, created: 0 },
    });
    const byLine = Object.fromEntries(
      (res.body.lines as { line: number; status: string; messages: string[] }[]).map((l) => [
        l.line,
        l,
      ]),
    );
    expect(byLine[2]).toMatchObject({
      status: 'ready',
      name: 'Ana Fictícia Lima',
      patientId: null,
    });
    expect(byLine[3]).toMatchObject({ status: 'ready' });
    expect(byLine[4]!.status).toBe('error');
    expect(byLine[4]!.messages).toEqual(
      expect.arrayContaining([
        'cpf: CPF inválido.',
        'data_nascimento: data inexistente; use DD/MM/AAAA.',
        'telefone: Telefone inválido: use DDD + número.',
        'telefone_whatsapp: use sim ou não.',
        expect.stringMatching(/^logradouro: /),
      ]),
    );
    expect(byLine[5]).toMatchObject({
      status: 'duplicate',
      messages: ['Repete o paciente da linha 2 deste arquivo.'],
    });
    expect(byLine[6]).toMatchObject({ status: 'duplicate', messages: ['CPF já cadastrado.'] });
    expect(byLine[7]).toMatchObject({
      status: 'duplicate',
      messages: [expect.stringMatching(/^Parecido com 1 cadastro/)],
    });
    // A resposta não repete CPF nem telefone.
    expect(JSON.stringify(res.body)).not.toMatch(/529\.?982|98765/);
    expect(await t.db.patient.count()).toBe(before);
  });

  it('a importação cadastra só as linhas prontas, sem consentimento, com versão e auditoria', async () => {
    const c = await setupClinic();
    await seedExisting(c.secretary.client);
    const res = await c.secretary.client.post('/patients/import', { csv: CSV });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      committed: true,
      totals: { ready: 0, error: 1, duplicate: 3, created: 2 },
    });
    const created = (res.body.lines as { status: string; patientId: string | null }[]).filter(
      (l) => l.status === 'created',
    );
    expect(created).toHaveLength(2);
    const ana = await c.secretary.client.get(`/patients/${created[0]!.patientId}`);
    expect(ana.body).toMatchObject({
      fullName: 'Ana Fictícia Lima',
      birthDate: '1985-04-15',
      cpf: CPF_A,
      phones: [{ number: '11987654321', whatsapp: true }],
      address: { zip: '01001000', city: 'São Paulo', state: 'SP' },
      communication: { channels: [], appointmentReminders: false, marketing: false },
    });
    const versions = await t.db.patientVersion.findMany({
      where: { patientId: created[0]!.patientId! },
    });
    expect(versions.map((v) => v.version)).toEqual([1]);
    const audited = await t.db.auditEvent.count({
      where: { reason: 'patient_imported', outcome: 'allowed' },
    });
    expect(audited).toBe(2);
    const summary = await t.db.auditEvent.findFirstOrThrow({
      where: { resourceType: 'patient_import', reason: { startsWith: 'patient_import:' } },
    });
    expect(summary.reason).toBe('patient_import:created=2,error=1,duplicate=3');
    expect(summary.actorUserId).toBe(c.secretary.user.id);

    // Importar o mesmo arquivo de novo não duplica: tudo vira duplicidade ou erro.
    const again = await c.secretary.client.post('/patients/import', { csv: CSV });
    expect(again.body.totals).toEqual({ ready: 0, error: 1, duplicate: 5, created: 0 });
  });

  it('nega o médico e o administrador, com a negação auditada', async () => {
    const c = await setupClinic();
    for (const who of ['doctor', 'admin'] as const) {
      for (const path of ['/patients/import/preview', '/patients/import']) {
        const res = await c[who].client.post(path, { csv: CSV });
        expect(res.status, `${who} ${path}`).toBe(403);
        expect(errorCode(res.body)).toBe('FORBIDDEN');
      }
    }
    const denied = await t.db.auditEvent.count({
      where: { resourceType: 'patient_import', outcome: 'denied' },
    });
    expect(denied).toBe(4);
    expect(await t.db.patient.count()).toBe(0);
  });

  it('recusa arquivo sem as colunas obrigatórias, vazio, grande ou com linhas demais', async () => {
    const c = await setupClinic();
    const post = (csv: string) => c.secretary.client.post('/patients/import', { csv });
    const noHeader = await post('nome;cpf\nAna;1');
    expect(noHeader.status).toBe(400);
    expect(noHeader.body.error.message).toMatch(/data_nascimento, telefone/);
    expect((await post('')).status).toBe(400);
    const tooMany =
      'nome;data_nascimento;telefone\n' +
      'Ana Fictícia;01/01/1990;11987654321\n'.repeat(PATIENT_IMPORT_MAX_ROWS + 1);
    const many = await post(tooMany);
    expect(many.status).toBe(400);
    expect(many.body.error.message).toMatch(/máximo por importação é 500/);
    const big = await post('nome;data_nascimento;telefone\n' + 'x'.repeat(300 * 1024));
    expect(big.status).toBe(400);
    expect(await t.db.patient.count()).toBe(0);
  });
});
