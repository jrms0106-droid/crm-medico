import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

export async function startTestApp(): Promise<INestApplication> {
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: process.env['DATABASE_URL_TEST'],
    NODE_ENV: 'test',
  });
  const app = await createApp(config);
  await app.init();
  return app;
}
