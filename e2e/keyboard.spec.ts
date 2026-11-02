import { type Locator, type Page, expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_TOTP_SECRET, USERS } from './fixtures.js';
import { currentStep, totpAt } from './totp.js';

/**
 * Fluxo da secretária feito só pelo teclado (Tab, Shift+Tab, Enter, Espaço e setas), sem
 * clique nem preenchimento direto. Complementa o roteiro de testes com pessoas
 * (docs/revisao/roteiro-testes-com-pessoas.md, tarefa S1); não substitui o teste com leitor
 * de tela.
 */

const MAX_TABS = 120;

/** Aperta Tab até o foco chegar no elemento. Falha se ele não for alcançável pelo teclado. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < MAX_TABS; i++) {
    if (await target.evaluate((el) => el.matches(':focus'))) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Não chegou pelo Tab em ${target.toString()}`);
}

async function focusedIsVisible(page: Page): Promise<boolean> {
  const focused = page.locator(':focus');
  if ((await focused.count()) !== 1) return false;
  return focused.evaluate((el) => {
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    return !!style && (style.outlineStyle !== 'none' || style.boxShadow !== 'none');
  });
}

/** Nascimento e telefone diferentes dos de flows.spec.ts, para não cair no aviso de duplicidade. */
const PATIENT = `Paciente Teclado E2E ${Date.now()}`;

test('secretária cadastra e agenda só pelo teclado, com foco sempre visível', async ({ page }) => {
  await page.goto('/');
  await tabTo(page, page.getByLabel('E-mail'));
  await page.keyboard.type(USERS.secretary.email);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Senha')).toBeFocused();
  await page.keyboard.type(E2E_PASSWORD);
  await page.keyboard.press('Enter');
  // A secretária também usa o código de 6 dígitos. O outro arquivo de teste pode ter usado os
  // passos de agora; esperar um passo novo evita código repetido, que o servidor recusa.
  const start = currentStep();
  while (currentStep() < start + 1) await page.waitForTimeout(1_000);
  await tabTo(page, page.getByLabel('Código de 6 dígitos'));
  await page.keyboard.type(totpAt(E2E_TOTP_SECRET, currentStep() + 1));
  await page.keyboard.press('Enter');
  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  await expect(menu).toBeVisible();

  // O primeiro Tab da página leva ao atalho "Pular para o conteúdo".
  await page.locator('body').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
  expect(await focusedIsVisible(page)).toBe(true);

  await tabTo(page, menu.getByRole('link', { name: 'Pacientes', exact: true }));
  expect(await focusedIsVisible(page)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();

  await tabTo(page, page.getByRole('button', { name: 'Novo paciente' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByLabel('Nome completo'));
  await page.keyboard.type(PATIENT);
  await tabTo(page, page.getByLabel('Data de nascimento'));
  await page.keyboard.type('03091979');
  await tabTo(page, page.getByLabel('Telefone com DDD'));
  await page.keyboard.type('21976543210');
  await tabTo(page, page.getByRole('button', { name: 'Cadastrar' }));
  expect(await focusedIsVisible(page)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: PATIENT })).toBeVisible();

  await tabTo(page, page.getByRole('link', { name: 'Agendar consulta' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText(`Paciente: ${PATIENT}`)).toBeVisible();
  const firstSlot = page.locator('.slot input').first();
  await tabTo(page, firstSlot);
  await page.keyboard.press('Space');
  await expect(firstSlot).toBeChecked();
  await tabTo(page, page.getByRole('button', { name: 'Agendar' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Consulta marcada');

  const row = page.getByRole('row', { name: new RegExp(PATIENT) });
  await tabTo(page, row.getByRole('button', { name: 'Confirmar' }));
  await page.keyboard.press('Enter');
  await expect(row).toContainText('Confirmada');
});
