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
const RANDOM_UUID = '01920000-0000-7000-8000-00000000abcd';

interface Clinic {
  organizationId: string;
  unitA: string;
  unitB: string;
  admin: TestUser;
  doctor: TestUser;
  secretary: TestUser;
  as: { admin: Client; doctor: Client; secretary: Client; secretaryB: Client };
}

/** Organização fictícia com duas unidades e um usuário de cada papel, já logados. */
async function setupClinic(): Promise<Clinic> {
  const org = await t.db.organization.create({ data: { name: 'Clínica Fictícia' } });
  const unitA = (await createUnit(t.db, org.id, 'Unidade A')).id;
  const unitB = (await createUnit(t.db, org.id, 'Unidade B')).id;
  const base = { organizationId: org.id, unitIds: [unitA] };
  const admin = await createUser(t.db, ['admin'], base);
  const doctor = await createUser(t.db, ['doctor'], base);
  const secretary = await createUser(t.db, ['secretary'], base);
  const secretaryB = await createUser(t.db, ['secretary'], { ...base, unitIds: [unitB] });

  const login = async (user: TestUser) => {
    const client = new Client(t.app);
    await client.loginFully(user, t.clock);
    return client;
  };
  return {
    organizationId: org.id,
    unitA,
    unitB,
    admin,
    doctor,
    secretary,
    as: {
      admin: await login(admin),
      doctor: await login(doctor),
      secretary: await login(secretary),
      secretaryB: await login(secretaryB),
    },
  };
}

async function lastAudit() {
  return t.db.auditEvent.findFirstOrThrow({ orderBy: { seq: 'desc' } });
}

describe('acesso permitido e negado em cada rota nova', () => {
  it('cada rota aceita o papel previsto e recusa os demais, auditando as duas decisões', async () => {
    const c = await setupClinic();
    await c.as.admin.reauth(c.admin, t.clock);
    const specialty = await c.as.admin.post('/specialties', { name: 'Cardiologia' });
    const professional = await c.as.admin.post('/professionals', {
      userId: c.doctor.id,
      crmNumber: '123456',
      crmState: 'SP',
    });
    expect(professional.status).toBe(201);

    type Call = (client: Client) => ReturnType<Client['get']>;
    const routes: {
      name: string;
      call: Call;
      allowed: keyof Clinic['as'];
      denied: (keyof Clinic['as'])[];
    }[] = [
      { name: 'GET /units', call: (x) => x.get('/units'), allowed: 'secretary', denied: [] },
      {
        name: 'POST /units',
        call: (x) => x.post('/units', { name: `Unidade ${Math.random()}` }),
        allowed: 'admin',
        denied: ['doctor', 'secretary'],
      },
      {
        name: 'PATCH /units/:id',
        call: (x) => x.patch(`/units/${c.unitA}`, { name: 'Unidade A' }),
        allowed: 'admin',
        denied: ['doctor', 'secretary'],
      },
      {
        name: 'GET /units/:id/professionals',
        call: (x) => x.get(`/units/${c.unitA}/professionals`),
        allowed: 'secretary',
        denied: ['secretaryB'],
      },
      {
        name: 'GET /specialties',
        call: (x) => x.get('/specialties'),
        allowed: 'doctor',
        denied: [],
      },
      {
        name: 'POST /specialties',
        call: (x) => x.post('/specialties', { name: `Especialidade ${Math.random()}` }),
        allowed: 'admin',
        denied: ['doctor', 'secretary'],
      },
      {
        name: 'PATCH /specialties/:id',
        call: (x) => x.patch(`/specialties/${specialty.body.id}`, { name: 'Cardiologia' }),
        allowed: 'admin',
        denied: ['doctor', 'secretary'],
      },
      {
        name: 'GET /professionals',
        call: (x) => x.get('/professionals'),
        allowed: 'secretary',
        denied: [],
      },
      {
        name: 'GET /professionals/:id',
        call: (x) => x.get(`/professionals/${professional.body.id}`),
        allowed: 'doctor',
        denied: [],
      },
      {
        name: 'PATCH /professionals/:id',
        call: (x) => x.patch(`/professionals/${professional.body.id}`, { crmNumber: '123456' }),
        allowed: 'admin',
        denied: ['doctor', 'secretary'],
      },
      {
        name: 'GET /admin/users',
        call: (x) => x.get('/admin/users'),
        allowed: 'admin',
        denied: ['doctor', 'secretary'],
      },
      {
        name: 'GET /admin/users/:id',
        call: (x) => x.get(`/admin/users/${c.doctor.id}`),
        allowed: 'admin',
        denied: ['doctor', 'secretary'],
      },
      {
        name: 'PATCH /admin/users/:id',
        call: (x) => x.patch(`/admin/users/${c.doctor.id}`, { name: 'Dra. Fictícia' }),
        allowed: 'admin',
        denied: ['doctor', 'secretary'],
      },
      {
        name: 'POST /admin/users/:id/reactivate',
        call: (x) => x.post(`/admin/users/${c.doctor.id}/reactivate`),
        allowed: 'admin',
        denied: ['doctor', 'secretary'],
      },
      {
        name: 'GET /audit/events',
        call: (x) => x.get('/audit/events'),
        allowed: 'admin',
        denied: ['doctor', 'secretary'],
      },
    ];

    for (const route of routes) {
      const ok = await route.call(c.as[route.allowed]);
      expect([200, 201, 204], `${route.name} por ${route.allowed}`).toContain(ok.status);
      expect((await lastAudit()).outcome, route.name).toBe('allowed');
      for (const role of route.denied) {
        const res = await route.call(c.as[role]);
        expect(res.status, `${route.name} por ${role}`).toBe(403);
        const audit = await lastAudit();
        expect(audit.outcome, `${route.name} por ${role}`).toBe('denied');
      }
    }
  });
});

describe('criações recusadas para quem não é administrador', () => {
  it('médico e secretária não criam contas nem fichas, mesmo reautenticados', async () => {
    const c = await setupClinic();
    for (const role of ['doctor', 'secretary'] as const) {
      const client = c.as[role];
      await client.reauth(c[role], t.clock);
      const user = await client.post('/admin/users', {
        name: 'Pessoa Fictícia',
        email: `nova-${role}@clinica-ficticia.test`,
        roles: ['admin'],
        unitIds: [c.unitA],
      });
      expect(user.status).toBe(403);
      expect(errorCode(user.body)).toBe('FORBIDDEN');
      const professional = await client.post('/professionals', {
        userId: c.doctor.id,
        crmNumber: '1',
        crmState: 'SP',
      });
      expect(professional.status).toBe(403);
      for (const path of ['reset-access', 'deactivate', 'reactivate']) {
        expect((await client.post(`/admin/users/${c.secretary.id}/${path}`)).status).toBe(403);
      }
    }
    expect(await t.db.professional.count()).toBe(0);
    expect(await t.db.user.count({ where: { email: { startsWith: 'nova-' } } })).toBe(0);
  });
});

describe('contas de usuário', () => {
  it('administrador cria conta com senha temporária, papéis e unidades, após reautenticar', async () => {
    const c = await setupClinic();
    const body = {
      name: 'Dra. Daniela (fictícia)',
      email: 'Daniela@Clinica-Ficticia.test',
      roles: ['doctor'],
      unitIds: [c.unitA, c.unitB],
    };
    const noReauth = await c.as.admin.post('/admin/users', body);
    expect(noReauth.status).toBe(403);
    expect(errorCode(noReauth.body)).toBe('REAUTH_REQUIRED');

    await c.as.admin.reauth(c.admin, t.clock);
    const res = await c.as.admin.post('/admin/users', body);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: 'daniela@clinica-ficticia.test',
      roles: ['doctor'],
      mustChangePassword: true,
      professionalId: null,
    });
    expect(res.body.user.unitIds.sort()).toEqual([c.unitA, c.unitB].sort());

    const client = new Client(t.app);
    const login = await client.login('daniela@clinica-ficticia.test', res.body.temporaryPassword);
    expect(login.status).toBe(200);

    const repeated = await c.as.admin.post('/admin/users', body);
    expect(repeated.status).toBe(409);
  });

  it('recusa unidade de outra organização', async () => {
    const c = await setupClinic();
    const other = await t.db.organization.create({ data: { name: 'Outra Clínica Fictícia' } });
    const foreignUnit = await createUnit(t.db, other.id);
    await c.as.admin.reauth(c.admin, t.clock);
    const res = await c.as.admin.post('/admin/users', {
      name: 'Pessoa Fictícia',
      email: 'pessoa@clinica-ficticia.test',
      roles: ['secretary'],
      unitIds: [foreignUnit.id],
    });
    expect(res.status).toBe(422);
  });

  it('mudar papéis exige reautenticação e derruba as sessões da pessoa', async () => {
    const c = await setupClinic();
    const change = { roles: ['secretary', 'doctor'] };
    const noReauth = await c.as.admin.patch(`/admin/users/${c.secretary.id}`, change);
    expect(errorCode(noReauth.body)).toBe('REAUTH_REQUIRED');

    await c.as.admin.reauth(c.admin, t.clock);
    const res = await c.as.admin.patch(`/admin/users/${c.secretary.id}`, change);
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual(['secretary', 'doctor']);
    expect((await c.as.secretary.get('/auth/me')).status).toBe(401);

    // Só o nome não mexe em permissões: dispensa reautenticação e mantém a sessão.
    t.clock.advance(10 * 60_000);
    const rename = await c.as.admin.patch(`/admin/users/${c.doctor.id}`, { name: 'Dr. Novo Nome' });
    expect(rename.status).toBe(200);
    expect((await c.as.doctor.get('/auth/me')).status).toBe(200);
  });

  it('administrador não tira o próprio papel de administrador', async () => {
    const c = await setupClinic();
    await c.as.admin.reauth(c.admin, t.clock);
    const res = await c.as.admin.patch(`/admin/users/${c.admin.id}`, { roles: ['doctor'] });
    expect(res.status).toBe(422);
  });

  it('desativar e reativar: a pessoa volta a entrar', async () => {
    const c = await setupClinic();
    await c.as.admin.reauth(c.admin, t.clock);
    expect((await c.as.admin.post(`/admin/users/${c.secretary.id}/deactivate`)).status).toBe(204);
    expect((await new Client(t.app).login(c.secretary.email, c.secretary.password)).status).toBe(
      401,
    );
    expect((await c.as.admin.post(`/admin/users/${c.secretary.id}/reactivate`)).status).toBe(204);
    expect((await new Client(t.app).login(c.secretary.email, c.secretary.password)).status).toBe(
      200,
    );
  });
});

describe('especialidades e fichas profissionais', () => {
  it('cadastra ficha com CRM/UF e RQE e a mostra na equipe da unidade', async () => {
    const c = await setupClinic();
    const cardio = await c.as.admin.post('/specialties', { name: 'Cardiologia' });
    expect(cardio.status).toBe(201);
    const res = await c.as.admin.post('/professionals', {
      userId: c.doctor.id,
      crmNumber: '123456',
      crmState: 'sp',
      specialties: [{ specialtyId: cardio.body.id, rqe: '7890' }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      userId: c.doctor.id,
      crmNumber: '123456',
      crmState: 'SP',
      specialties: [{ id: cardio.body.id, name: 'Cardiologia', rqe: '7890' }],
    });

    const team = await c.as.secretary.get(`/units/${c.unitA}/professionals`);
    expect(team.status).toBe(200);
    expect(team.body.map((p: { id: string }) => p.id)).toEqual([res.body.id]);
    const otherTeam = await c.as.admin.get(`/units/${c.unitB}/professionals`);
    expect(otherTeam.status).toBe(403);
  });

  it('recusa ficha para quem não é médico, CRM/UF repetido, UF inválida e especialidade inativa', async () => {
    const c = await setupClinic();
    const forSecretary = await c.as.admin.post('/professionals', {
      userId: c.secretary.id,
      crmNumber: '1',
      crmState: 'SP',
    });
    expect(forSecretary.status).toBe(422);

    const badState = await c.as.admin.post('/professionals', {
      userId: c.doctor.id,
      crmNumber: '1',
      crmState: 'XX',
    });
    expect(badState.status).toBe(400);

    const old = await c.as.admin.post('/specialties', { name: 'Especialidade Antiga' });
    await c.as.admin.patch(`/specialties/${old.body.id}`, { active: false });
    const inactive = await c.as.admin.post('/professionals', {
      userId: c.doctor.id,
      crmNumber: '1',
      crmState: 'SP',
      specialties: [{ specialtyId: old.body.id }],
    });
    expect(inactive.status).toBe(422);

    const first = await c.as.admin.post('/professionals', {
      userId: c.doctor.id,
      crmNumber: '1',
      crmState: 'SP',
    });
    expect(first.status).toBe(201);
    const other = await createUser(t.db, ['doctor'], { organizationId: c.organizationId });
    const sameCrm = await c.as.admin.post('/professionals', {
      userId: other.id,
      crmNumber: '1',
      crmState: 'SP',
    });
    expect(sameCrm.status).toBe(409);
    const secondForSameUser = await c.as.admin.post('/professionals', {
      userId: c.doctor.id,
      crmNumber: '2',
      crmState: 'RJ',
    });
    expect(secondForSameUser.status).toBe(409);
  });
});

describe('unidades', () => {
  it('cada pessoa vê só as suas unidades; o administrador vê todas', async () => {
    const c = await setupClinic();
    const mine = await c.as.secretaryB.get('/units');
    expect(mine.body.map((u: { id: string }) => u.id)).toEqual([c.unitB]);
    const all = await c.as.admin.get('/units');
    expect(all.body.map((u: { id: string }) => u.id).sort()).toEqual([c.unitA, c.unitB].sort());
  });

  it('usuário de outra unidade é negado na equipe da unidade alheia, com auditoria', async () => {
    const c = await setupClinic();
    const res = await c.as.secretaryB.get(`/units/${c.unitA}/professionals`);
    expect(res.status).toBe(403);
    expect(await lastAudit()).toMatchObject({
      outcome: 'denied',
      reason: 'other_unit',
      resourceType: 'unit_professionals',
      unitId: c.unitA,
    });
  });
});

describe('identificadores manipulados na URL', () => {
  it('id de outra organização ou inexistente dá 404 e fica auditado', async () => {
    const c = await setupClinic();
    const outsider = await createUser(t.db, ['doctor']);
    const foreignUnit = await createUnit(t.db, outsider.organizationId);

    const cases = [
      {
        client: c.as.admin,
        path: `/admin/users/${outsider.id}`,
        type: 'user_account',
        id: outsider.id,
      },
      {
        client: c.as.admin,
        path: `/admin/users/${RANDOM_UUID}`,
        type: 'user_account',
        id: RANDOM_UUID,
      },
      {
        client: c.as.secretary,
        path: `/units/${foreignUnit.id}/professionals`,
        type: 'unit',
        id: foreignUnit.id,
      },
      {
        client: c.as.doctor,
        path: `/professionals/${RANDOM_UUID}`,
        type: 'professional',
        id: RANDOM_UUID,
      },
    ];
    for (const item of cases) {
      const res = await item.client.get(item.path);
      expect(res.status, item.path).toBe(404);
      expect(errorCode(res.body)).toBe('NOT_FOUND');
      expect(await lastAudit(), item.path).toMatchObject({
        outcome: 'not_found',
        reason: 'not_found_in_scope',
        resourceType: item.type,
        resourceId: item.id,
      });
    }
  });

  it('id de outra organização na edição também dá 404', async () => {
    const c = await setupClinic();
    const other = await t.db.organization.create({ data: { name: 'Outra Clínica Fictícia' } });
    const foreignUnit = await createUnit(t.db, other.id);
    const res = await c.as.admin.patch(`/units/${foreignUnit.id}`, { name: 'Invadida' });
    expect(res.status).toBe(404);
    const unchanged = await t.db.unit.findUniqueOrThrow({ where: { id: foreignUnit.id } });
    expect(unchanged.name).not.toBe('Invadida');
  });
});

describe('trilha de auditoria', () => {
  it('registra quem, de onde, a requisição e o motivo, sem conteúdo dos dados', async () => {
    const c = await setupClinic();
    const res = await c.as.secretary.get('/admin/users').set('x-request-id', 'teste-auditoria-001');
    expect(res.status).toBe(403);
    const event = await lastAudit();
    expect(event).toMatchObject({
      organizationId: c.organizationId,
      actorUserId: c.secretary.id,
      requestId: 'teste-auditoria-001',
      action: 'view',
      resourceType: 'user_account',
      outcome: 'denied',
      reason: 'default_deny',
    });
    expect(event.ip).toBeTruthy();
    expect(event.sessionId).toBeTruthy();
  });

  it('eventos não podem ser alterados nem apagados, nem por SQL direto', async () => {
    const c = await setupClinic();
    await c.as.admin.get('/units');
    const event = await lastAudit();
    await expect(
      t.db.auditEvent.update({ where: { id: event.id }, data: { outcome: 'denied' } }),
    ).rejects.toThrow();
    await expect(t.db.$executeRawUnsafe('DELETE FROM audit.events')).rejects.toThrow(
      /apenas inclusão/,
    );
    expect(await t.db.auditEvent.count()).toBeGreaterThan(0);
  });

  it('o administrador consulta só a auditoria da própria organização, com filtro', async () => {
    const c = await setupClinic();
    const outsider = await createUser(t.db, ['admin']);
    const outsiderClient = new Client(t.app);
    await outsiderClient.loginFully(outsider, t.clock);
    await outsiderClient.get('/units');
    await c.as.doctor.get('/admin/users');

    const res = await c.as.admin.get('/audit/events?outcome=denied&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const e of res.body) expect(e.outcome).toBe('denied');
    expect(res.body.some((e: { actorUserId: string }) => e.actorUserId === c.doctor.id)).toBe(true);
    expect(res.body.some((e: { actorUserId: string }) => e.actorUserId === outsider.id)).toBe(
      false,
    );

    expect((await c.as.admin.get('/audit/events?limit=999')).status).toBe(400);
  });
});
