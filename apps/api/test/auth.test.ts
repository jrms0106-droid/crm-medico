import 'dotenv/config';
import { errorResponseSchema, sessionInfoSchema } from '@crm/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totpAt } from '../src/identity/totp.js';
import { Client, MINUTE, type TestApp, createUser, resetData, startTestApp } from './helpers.js';

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

describe('login com senha', () => {
  it('login válido de secretária pede o código de 6 dígitos e cria cookie seguro', async () => {
    const user = await createUser(t.db, ['secretary']);
    const client = new Client(t.app);
    const res = await client.login(user.email, user.password);

    expect(res.status).toBe(200);
    const info = sessionInfoSchema.parse(res.body);
    // Desde 2026-11-02 o código é obrigatório também para a secretária (padrão de MFA_REQUIRED_ROLES).
    expect(info.state).toBe('pending_mfa');
    expect((await client.post('/patients/search', { q: 'ab' })).status).toBe(403);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/crm_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect((await client.get('/auth/me')).status).toBe(200);
  });

  it('o banco guarda só o hash do token de sessão', async () => {
    const user = await createUser(t.db, ['secretary']);
    const client = new Client(t.app);
    const res = await client.login(user.email, user.password);
    const token = /crm_session=([^;]+)/.exec(String(res.headers['set-cookie']))?.[1];
    const sessions = await t.db.session.findMany();
    expect(token).toBeTruthy();
    expect(sessions[0]?.tokenHash).not.toContain(token);
    expect(sessions[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('senha errada e e-mail inexistente dão a mesma resposta', async () => {
    const user = await createUser(t.db, ['secretary']);
    const client = new Client(t.app);
    const wrong = await client.login(user.email, 'senha-errada-qualquer');
    const unknown = await client.login('ninguem@clinica-ficticia.test', 'senha-errada-qualquer');

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(errorCode(wrong.body)).toBe('INVALID_CREDENTIALS');
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('usuário desativado não entra', async () => {
    const user = await createUser(t.db, ['secretary']);
    await t.db.user.update({ where: { id: user.id }, data: { active: false } });
    expect((await new Client(t.app).login(user.email, user.password)).status).toBe(401);
  });

  it('corpo inválido ou com campos extras é recusado com detalhes', async () => {
    const res = await request(t.app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nao-e-email', password: 'x', role: 'admin' });
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('5 falhas bloqueiam a conta por 15 minutos, mesmo com a senha certa', async () => {
    const user = await createUser(t.db, ['secretary']);
    const client = new Client(t.app);
    for (let i = 0; i < 5; i++) {
      expect((await client.login(user.email, 'senha-errada-qualquer')).status).toBe(401);
    }
    const locked = await client.login(user.email, user.password);
    expect(locked.status).toBe(423);
    expect(errorCode(locked.body)).toBe('ACCOUNT_LOCKED');

    t.clock.advance(16 * MINUTE);
    expect((await client.login(user.email, user.password)).status).toBe(200);
  });

  it('limite por IP devolve 429', async () => {
    const limited = await startTestApp({ LOGIN_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const client = new Client(limited.app);
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        statuses.push((await client.login('x@clinica-ficticia.test', 'senha-errada')).status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.app.close();
      await limited.db.$disconnect();
    }
  });

  it('atrás de um proxy, trocar o X-Forwarded-For não escapa do limite por IP', async () => {
    const limited = await startTestApp({ LOGIN_RATE_LIMIT_PER_MINUTE: '3', TRUST_PROXY: '1' });
    try {
      const server = limited.app.getHttpServer();
      const attempt = (forwarded: string) =>
        request(server)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', forwarded)
          .send({ email: 'x@clinica-ficticia.test', password: 'senha-errada' });
      // O cliente inventa o primeiro IP a cada tentativa; o proxy acrescenta o IP real no fim.
      const statuses: number[] = [];
      for (let i = 1; i <= 4; i++)
        statuses.push((await attempt(`10.0.0.${i}, 203.0.113.7`)).status);
      expect(statuses).toEqual([401, 401, 401, 429]);
      // Outro cliente real (outro IP visto pelo proxy) não é afetado.
      expect((await attempt('10.0.0.1, 203.0.113.8')).status).toBe(401);
    } finally {
      await limited.app.close();
      await limited.db.$disconnect();
    }
  });

  it('o limite é contado no banco: vale entre instâncias, vence com a janela e não guarda o IP', async () => {
    const a = await startTestApp({ LOGIN_RATE_LIMIT_PER_MINUTE: '3' });
    const b = await startTestApp({ LOGIN_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const statuses: number[] = [];
      for (const app of [a, b, a, b]) {
        const res = await new Client(app.app).login('x@clinica-ficticia.test', 'senha-errada');
        statuses.push(res.status);
      }
      // Duas "instâncias" da API somam as tentativas da mesma origem.
      expect(statuses).toEqual([401, 401, 401, 429]);
      const rows = await a.db.loginRateLimit.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0]!.keyHash).not.toContain('127.0.0.1');

      // Passada a janela de um minuto, a contagem recomeça.
      a.clock.advance(61_000);
      const again = await new Client(a.app).login('x@clinica-ficticia.test', 'senha-errada');
      expect(again.status).toBe(401);
    } finally {
      for (const app of [a, b]) {
        await app.app.close();
        await app.db.$disconnect();
      }
    }
  });
});

describe('acesso sem autenticação', () => {
  it('rotas protegidas exigem login (401), inclusive com cookie inventado', async () => {
    const server = t.app.getHttpServer();
    expect((await request(server).get('/api/v1/auth/me')).status).toBe(401);
    const forged = await request(server)
      .get('/api/v1/auth/me')
      .set('Cookie', 'crm_session=token-inventado-pelo-atacante');
    expect(forged.status).toBe(401);
    expect(errorCode(forged.body)).toBe('SESSION_EXPIRED');
  });

  it('a saúde da API continua pública', async () => {
    expect((await request(t.app.getHttpServer()).get('/api/v1/health')).status).toBe(200);
  });
});

describe('expiração e revogação de sessão', () => {
  it('expira após 30 minutos sem uso', async () => {
    const user = await createUser(t.db, ['secretary']);
    const client = new Client(t.app);
    await client.login(user.email, user.password);

    t.clock.advance(29 * MINUTE);
    expect((await client.get('/auth/me')).status).toBe(200);
    t.clock.advance(31 * MINUTE);
    const res = await client.get('/auth/me');
    expect(res.status).toBe(401);
    expect(errorCode(res.body)).toBe('SESSION_EXPIRED');
  });

  it('expira após 12 horas mesmo em uso contínuo', async () => {
    const user = await createUser(t.db, ['secretary']);
    const client = new Client(t.app);
    await client.login(user.email, user.password);
    // 24 × 29 min = 11h36: ainda vale. Mais 29 min passa das 12 h.
    for (let i = 0; i < 24; i++) {
      t.clock.advance(29 * MINUTE);
      expect((await client.get('/auth/me')).status).toBe(200);
    }
    t.clock.advance(29 * MINUTE);
    expect((await client.get('/auth/me')).status).toBe(401);
  });

  it('logout encerra a sessão no servidor', async () => {
    const user = await createUser(t.db, ['secretary']);
    const client = new Client(t.app);
    await client.login(user.email, user.password);
    expect((await client.post('/auth/logout')).status).toBe(204);
    expect((await client.get('/auth/me')).status).toBe(401);
  });

  it('desativar o usuário derruba a sessão na hora', async () => {
    const admin = await createUser(t.db, ['admin']);
    const sec = await createUser(t.db, ['secretary'], { organizationId: admin.organizationId });
    const adminClient = new Client(t.app);
    await adminClient.loginFully(admin, t.clock);
    await adminClient.reauth(admin, t.clock);
    const secClient = new Client(t.app);
    await secClient.login(sec.email, sec.password);

    expect((await adminClient.post(`/admin/users/${sec.id}/deactivate`)).status).toBe(204);
    expect((await secClient.get('/auth/me')).status).toBe(401);
  });
});

describe('proteção CSRF', () => {
  it('requisição que altera dados sem o token CSRF é recusada', async () => {
    const user = await createUser(t.db, ['secretary']);
    const client = new Client(t.app);
    await client.login(user.email, user.password);
    const res = await client.agent.post('/api/v1/auth/logout');
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe('CSRF_FAILED');
    expect((await client.get('/auth/me')).status).toBe(200);
  });
});

describe('verificação em duas etapas (MFA)', () => {
  it('médico precisa cadastrar MFA antes de usar o sistema', async () => {
    const doctor = await createUser(t.db, ['doctor']);
    const client = new Client(t.app);
    const login = await client.login(doctor.email, doctor.password);
    expect(login.body.state).toBe('pending_mfa');

    const blocked = await client.post('/auth/reauth', { password: doctor.password });
    expect(blocked.status).toBe(403);
    expect(errorCode(blocked.body)).toBe('MFA_REQUIRED');

    const setup = await client.post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    const wrong = await client.post('/auth/mfa/activate', { code: '000000' });
    expect(wrong.status).toBe(400);

    const ok = await client.post('/auth/mfa/activate', {
      code: totpAt(setup.body.secret, t.clock.now()),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe('active');
    expect(ok.body.mfaEnabled).toBe(true);
  });

  it('o segredo do MFA fica criptografado no banco', async () => {
    const doctor = await createUser(t.db, ['doctor']);
    const secret = await new Client(t.app).loginFully(doctor, t.clock);
    const row = await t.db.user.findUniqueOrThrow({ where: { id: doctor.id } });
    expect(secret).toBeTruthy();
    expect(row.mfaSecretEnc).toMatch(/^v1\./);
    expect(row.mfaSecretEnc).not.toContain(secret);
  });

  it('nos logins seguintes o código é pedido, e o mesmo código não vale duas vezes', async () => {
    const doctor = await createUser(t.db, ['doctor']);
    const secret = (await new Client(t.app).loginFully(doctor, t.clock)) ?? '';

    t.clock.advance(MINUTE);
    const client = new Client(t.app);
    expect((await client.login(doctor.email, doctor.password)).body.state).toBe('pending_mfa');
    const code = totpAt(secret, t.clock.now());
    expect((await client.post('/auth/mfa/verify', { code })).status).toBe(200);

    const other = new Client(t.app);
    await other.login(doctor.email, doctor.password);
    const reused = await other.post('/auth/mfa/verify', { code });
    expect(reused.status).toBe(400);
    expect(errorCode(reused.body)).toBe('INVALID_MFA_CODE');
  });

  it('códigos errados repetidos bloqueiam a conta', async () => {
    const doctor = await createUser(t.db, ['doctor']);
    await new Client(t.app).loginFully(doctor, t.clock);
    const client = new Client(t.app);
    await client.login(doctor.email, doctor.password);
    for (let i = 0; i < 5; i++) await client.post('/auth/mfa/verify', { code: '123456' });
    expect((await client.login(doctor.email, doctor.password)).status).toBe(423);
  });

  it('sessão pendente de MFA não pode pular a etapa', async () => {
    const admin = await createUser(t.db, ['admin']);
    const target = await createUser(t.db, ['secretary'], { organizationId: admin.organizationId });
    const client = new Client(t.app);
    await client.login(admin.email, admin.password);
    const res = await client.post(`/admin/users/${target.id}/reset-access`);
    expect(res.status).toBe(403);
    expect(errorCode(res.body)).toBe('MFA_REQUIRED');
  });
});

describe('reautenticação para ações críticas', () => {
  it('exige senha e código, e registra o momento', async () => {
    const doctor = await createUser(t.db, ['doctor']);
    const client = new Client(t.app);
    const secret = (await client.loginFully(doctor, t.clock)) ?? '';
    t.clock.advance(MINUTE);

    const noCode = await client.post('/auth/reauth', { password: doctor.password });
    expect(noCode.status).toBe(400);
    const ok = await client.post('/auth/reauth', {
      password: doctor.password,
      code: totpAt(secret, t.clock.now()),
    });
    expect(ok.status).toBe(204);
    const session = await t.db.session.findFirstOrThrow({
      where: { userId: doctor.id, revokedAt: null },
    });
    expect(session.reauthAt).not.toBeNull();
  });
});

describe('recuperação de acesso pelo administrador', () => {
  it('gera senha temporária, obriga a troca e derruba sessões antigas', async () => {
    const admin = await createUser(t.db, ['admin']);
    const doctor = await createUser(t.db, ['doctor'], { organizationId: admin.organizationId });
    const adminClient = new Client(t.app);
    await adminClient.loginFully(admin, t.clock);
    const oldDoctorClient = new Client(t.app);
    await oldDoctorClient.loginFully(doctor, t.clock);

    const withoutReauth = await adminClient.post(`/admin/users/${doctor.id}/reset-access`);
    expect(errorCode(withoutReauth.body)).toBe('REAUTH_REQUIRED');
    await adminClient.reauth(admin, t.clock);
    const reset = await adminClient.post(`/admin/users/${doctor.id}/reset-access`);
    expect(reset.status).toBe(200);
    const temporaryPassword: string = reset.body.temporaryPassword;
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect((await oldDoctorClient.get('/auth/me')).status).toBe(401);

    // Próximo login: MFA de novo (foi apagado) e depois troca de senha.
    const client = new Client(t.app);
    await client.loginFully({ ...doctor, password: temporaryPassword }, t.clock);
    expect((await client.get('/auth/me')).body.state).toBe('password_change_required');

    const weak = await client.post('/auth/password', {
      currentPassword: temporaryPassword,
      newPassword: 'curta',
    });
    expect(errorCode(weak.body)).toBe('WEAK_PASSWORD');

    const changed = await client.post('/auth/password', {
      currentPassword: temporaryPassword,
      newPassword: 'outra-senha-ficticia-forte',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.state).toBe('active');
  });

  it('secretária e médico não podem redefinir acesso de ninguém (403)', async () => {
    const admin = await createUser(t.db, ['admin']);
    const target = await createUser(t.db, ['secretary'], { organizationId: admin.organizationId });
    for (const roles of [['secretary'], ['doctor']] as const) {
      const user = await createUser(t.db, [...roles], { organizationId: admin.organizationId });
      const client = new Client(t.app);
      await client.loginFully(user, t.clock);
      const res = await client.post(`/admin/users/${target.id}/reset-access`);
      expect(res.status).toBe(403);
      expect(errorCode(res.body)).toBe('FORBIDDEN');
    }
  });

  it('administrador não alcança usuário de outra organização (404)', async () => {
    const admin = await createUser(t.db, ['admin']);
    const outsider = await createUser(t.db, ['secretary']);
    const client = new Client(t.app);
    await client.loginFully(admin, t.clock);
    await client.reauth(admin, t.clock);
    expect((await client.post(`/admin/users/${outsider.id}/reset-access`)).status).toBe(404);
  });

  it('identificador manipulado na URL é recusado sem erro interno', async () => {
    const admin = await createUser(t.db, ['admin']);
    const client = new Client(t.app);
    await client.loginFully(admin, t.clock);
    const res = await client.post(`/admin/users/1%20OR%201=1/reset-access`);
    expect(res.status).toBe(400);
    expect(errorCode(res.body)).toBe('VALIDATION_FAILED');
  });

  it('administrador não redefine o próprio acesso', async () => {
    const admin = await createUser(t.db, ['admin']);
    const client = new Client(t.app);
    await client.loginFully(admin, t.clock);
    await client.reauth(admin, t.clock);
    expect((await client.post(`/admin/users/${admin.id}/reset-access`)).status).toBe(422);
  });
});
