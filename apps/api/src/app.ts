import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NestExpressApplication } from '@nestjs/platform-express';
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
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  // Atrás de um proxy reverso (produção), o IP real vem do cabeçalho X-Forwarded-For.
  app.set('trust proxy', config.TRUST_PROXY);
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
