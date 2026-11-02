import { test as base, expect } from '@playwright/test';
import { e2eNow } from './clock.js';

/** `test` com o relógio do navegador já deslocado antes de qualquer página abrir. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.clock.install({ time: e2eNow() });
    await use(page);
  },
});

export { expect };
