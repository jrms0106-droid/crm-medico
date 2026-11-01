import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule, type AppOverrides } from './app.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { requestIdMiddleware } from './common/request-id.js';
import type { AppConfig } from './config.js';

/** Monta a aplicação com todas as proteções globais. Usado pelo servidor e pelos testes. */
export async function createApp(
  config: AppConfig,
  overrides: AppOverrides = {},
): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config, overrides),
    {
      logger: config.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
    },
  );
  // A importação de pacientes manda a planilha (até 256 KB) no JSON; o padrão do Express é 100 KB.
  app.useBodyParser('json', { limit: '1mb' });
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  // Atrás de proxy reverso, o IP real vem do X-Forwarded-For, contando só os proxies de
  // confiança a partir da direita. Com `true` o Express pegaria o primeiro IP da lista, que o
  // cliente escreve como quiser, e o limite de login por IP deixaria de valer.
  app.set('trust proxy', config.TRUST_PROXY === 0 ? false : config.TRUST_PROXY);
  // Respostas da API trazem dado pessoal ou clínico: o navegador e proxies não guardam cópia.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  });
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
