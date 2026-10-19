import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { requestIdMiddleware } from './common/request-id.js';
import type { AppConfig } from './config.js';

/** Monta a aplicação com todas as proteções globais. Usado pelo servidor e pelos testes. */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config), {
    logger: config.NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
  });
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
