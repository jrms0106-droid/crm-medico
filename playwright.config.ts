import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * Testes ponta a ponta no navegador (Etapa 7). Sobem a API e o aplicativo web já compilados
 * (`npm run build`) contra o banco de TESTE, que é apagado por e2e/seed.ts.
 */
const API_PORT = 3100;
const WEB_PORT = 4173;
const dbUrl = process.env['E2E_DATABASE_URL'] ?? process.env['DATABASE_URL_TEST'] ?? '';
// Chaves públicas de teste (as mesmas do .env.example); nunca usar fora de testes.
const testKeys = {
  MFA_ENCRYPTION_KEY:
    process.env['MFA_ENCRYPTION_KEY'] ?? 'ZGV2LXNvbWVudGUtbmFvLXVzYXItZW0tcHJvZHVjYW8=',
  PII_ENCRYPTION_KEY:
    process.env['PII_ENCRYPTION_KEY'] ?? 'cGlpLWRldi1zb21lbnRlLW5hby11c2FyLWVtLXByb2Q=',
};

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // No contêiner de desenvolvimento o Chromium já vem instalado; no CI, o Playwright instala.
        launchOptions: process.env['PW_CHROMIUM_PATH']
          ? { executablePath: process.env['PW_CHROMIUM_PATH'] }
          : {},
      },
    },
  ],
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      port: API_PORT,
      reuseExistingServer: false,
      env: {
        ...testKeys,
        DATABASE_URL: dbUrl,
        API_PORT: String(API_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        NODE_ENV: 'test',
        COOKIE_SECURE: 'false',
      },
    },
    {
      command: `npx vite preview --port ${WEB_PORT} --strictPort`,
      cwd: 'apps/web',
      port: WEB_PORT,
      reuseExistingServer: false,
      env: { API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
