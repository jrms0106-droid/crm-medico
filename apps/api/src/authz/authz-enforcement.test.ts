import 'reflect-metadata';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_KEY } from '../identity/auth.decorators.js';
import {
  AuthorizationEnforcedInterceptor,
  SelfService,
  markAuthorizationChecked,
} from './authz-enforcement.js';

function run(meta: Record<string, boolean>, auth: object | undefined) {
  const handler = () => undefined;
  for (const [key, value] of Object.entries(meta)) Reflect.defineMetadata(key, value, handler);
  const context = {
    getType: () => 'http',
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ auth, method: 'GET', route: { path: '/x' } }) }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of('dados') };
  return firstValueFrom(
    new AuthorizationEnforcedInterceptor(new Reflector()).intercept(context, next),
  );
}

async function expectForbidden(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as { getStatus: () => number },
  );
  expect(error?.getStatus()).toBe(403);
}

describe('autorização obrigatória em toda rota com login', () => {
  it('rota que terminou sem decisão da política vira 403', async () => {
    await expectForbidden(run({}, {}));
  });

  it('rota que passou pela política devolve a resposta', async () => {
    const auth = {};
    markAuthorizationChecked(auth);
    await expect(run({}, auth)).resolves.toBe('dados');
  });

  it('a marca vale só para a própria requisição', async () => {
    markAuthorizationChecked({});
    await expectForbidden(run({}, {}));
  });

  it('rota pública e rota da própria sessão não precisam de decisão', async () => {
    await expect(run({ [PUBLIC_KEY]: true }, undefined)).resolves.toBe('dados');
    const handler = () => undefined;
    SelfService()(handler, 'x', { value: handler });
    const key = Reflect.getMetadataKeys(handler)[0] as string;
    await expect(run({ [key]: true }, {})).resolves.toBe('dados');
  });
});
