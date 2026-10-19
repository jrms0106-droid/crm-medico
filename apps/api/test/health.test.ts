import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { errorResponseSchema, healthResponseSchema } from '@crm/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, startTestApp } from './helpers.js';

describe('API: saúde e formato de erro (integração com PostgreSQL real)', () => {
  let t: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    t = await startTestApp();
    app = t.app;
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /api/v1/health responde ok com o banco conectado', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const body = healthResponseSchema.parse(res.body);
    expect(body).toMatchObject({ status: 'ok', database: 'ok', clinicalUseApproved: false });
  });

  it('rota inexistente devolve 404 no formato padrão, com requestId', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nao-existe').expect(404);
    const body = errorResponseSchema.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('JSON malformado devolve 400 sem vazar detalhes internos', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/health')
      .set('content-type', 'application/json')
      .send('{"quebrado":')
      .expect(400);
    const body = errorResponseSchema.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(body)).not.toMatch(/SyntaxError|stack|at /);
  });

  it('respeita um x-request-id válido e substitui um inválido', async () => {
    const ok = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', 'teste-1234-abcd');
    expect(ok.headers['x-request-id']).toBe('teste-1234-abcd');

    const bad = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-request-id', '<script>');
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });

  it('envia cabeçalhos de segurança', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
