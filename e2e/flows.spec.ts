import { type Page, expect, test } from '@playwright/test';
import { E2E_PASSWORD, E2E_TOTP_SECRET, USERS, type UserKey } from './fixtures.js';
import { currentStep, totpAt } from './totp.js';

/**
 * O servidor recusa repetir um passo TOTP já usado pela mesma pessoa. Guardamos o último usado
 * e escolhemos o próximo aceito (até um passo adiante), esperando a virada se preciso.
 */
const lastStep: Partial<Record<UserKey, number>> = {};
async function nextCode(user: UserKey): Promise<string> {
  let step = Math.max(currentStep() - 1, (lastStep[user] ?? 0) + 1);
  while (step > currentStep() + 1) {
    await new Promise((r) => setTimeout(r, 2_000));
    step = Math.max(currentStep() - 1, (lastStep[user] ?? 0) + 1);
  }
  lastStep[user] = step;
  return totpAt(E2E_TOTP_SECRET, step);
}

async function login(page: Page, user: UserKey) {
  await page.goto('/');
  await page.getByLabel('E-mail').fill(USERS[user].email);
  await page.getByLabel('Senha').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  if (USERS[user].mfa) {
    await page.getByLabel('Código de 6 dígitos').fill(await nextCode(user));
    await page.getByRole('button', { name: 'Confirmar' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Menu principal' })).toBeVisible();
}

/** Com E2E_SCREENSHOTS=<pasta>, guarda imagens das telas para a revisão do PR. */
async function snap(page: Page, name: string) {
  const dir = process.env['E2E_SCREENSHOTS'];
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

const menu = (page: Page) => page.getByRole('navigation', { name: 'Menu principal' });

const PATIENT = `Paciente Fictícia E2E ${Date.now()}`;

test.describe.serial('fluxos por perfil', () => {
  test('menus mudam conforme o perfil', async ({ page }) => {
    await login(page, 'admin');
    await expect(menu(page).getByRole('link')).toHaveText([
      'Início',
      'Profissionais',
      'Auditoria',
      'Configurações',
    ]);
    // O administrador não acessa pacientes, nem digitando o endereço.
    await page.goto('/#/pacientes');
    await expect(page.getByText('Esta área não faz parte do seu perfil.')).toBeVisible();
    await page.getByRole('button', { name: 'Sair' }).click();

    await login(page, 'secretary');
    await expect(menu(page).getByRole('link')).toHaveText([
      'Início',
      'Pacientes',
      'Agenda',
      'Profissionais',
    ]);
    await page.goto('/#/auditoria');
    await expect(page.getByText('Esta área não faz parte do seu perfil.')).toBeVisible();
  });

  test('secretária cadastra o paciente, marca a consulta e registra a chegada', async ({
    page,
  }) => {
    await login(page, 'secretary');
    await menu(page).getByRole('link', { name: 'Pacientes' }).click();
    await page.getByRole('button', { name: 'Novo paciente' }).click();
    await page.getByLabel('Nome completo').fill(PATIENT);
    await page.getByLabel('Data de nascimento').fill('1985-04-12');
    await page.getByLabel('Telefone com DDD').fill('11987654321');
    await page.getByRole('button', { name: 'Cadastrar' }).click();
    await expect(page.getByRole('heading', { name: PATIENT })).toBeVisible();

    await page.getByRole('link', { name: 'Agendar consulta' }).click();
    await expect(page.getByText(`Paciente: ${PATIENT}`)).toBeVisible();
    await page.locator('.slot').first().click();
    await page.getByRole('button', { name: 'Agendar' }).click();
    await expect(page.getByRole('status')).toContainText('Consulta marcada');

    const row = page.getByRole('row', { name: new RegExp(PATIENT) });
    await expect(row).toContainText('Agendada');
    await row.getByRole('button', { name: 'Confirmar' }).click();
    await expect(row).toContainText('Confirmada');
    await row.getByRole('button', { name: 'Registrar chegada' }).click();
    await expect(row).toContainText('Paciente chegou');
    await snap(page, '1-agenda-secretaria');
  });

  test('médico atende, registra e assina o prontuário e uma receita', async ({ page }) => {
    await login(page, 'doctor');
    await menu(page).getByRole('link', { name: 'Agenda' }).click();
    const row = page.getByRole('row', { name: new RegExp(PATIENT) });
    await row.getByRole('button', { name: 'Iniciar atendimento' }).click();
    await expect(page.getByRole('heading', { name: `Prontuário de ${PATIENT}` })).toBeVisible();
    await expect(page.getByText('Vínculo: Atendimento iniciado')).toBeVisible();

    await page.getByRole('button', { name: 'Novo registro' }).click();
    await page.getByLabel('Motivo da consulta').fill('Dor de cabeça há dois dias (fictício).');
    await page.getByLabel('Anamnese').fill('Relato fictício para teste automatizado.');
    await page.getByLabel('Conduta').fill('Analgésico e retorno se piorar.');
    await snap(page, '2-prontuario-rascunho');
    await page.getByRole('button', { name: 'Finalizar' }).click();

    await page.getByRole('button', { name: 'Assinar' }).click();
    await page.getByLabel('Sua senha').fill(E2E_PASSWORD);
    await page.getByLabel('Código de 6 dígitos').fill(await nextCode('doctor'));
    await page.getByRole('button', { name: 'Confirmar e assinar' }).click();
    await expect(page.getByText('Conteúdo íntegro.')).toBeVisible();
    await expect(page.locator('.timeline').first()).toContainText('Assinado');
    await snap(page, '3-prontuario-assinado');

    // Receita simples: rascunho, assinatura e PDF.
    const docs = page.locator('.panel', { has: page.getByRole('heading', { name: 'Documentos' }) });
    await docs.getByRole('button', { name: 'Receita simples' }).click();
    await page.getByLabel('Medicamento 1').fill('Dipirona 500 mg (fictício)');
    await page.getByLabel('Posologia 1').fill('1 comprimido a cada 6 horas, se dor.');
    await page.getByLabel('Quantidade (opcional) 1').fill('1 caixa');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    const doc = page.locator('[aria-label="Documento"]');
    await expect(doc.getByText('Rascunho', { exact: true })).toBeVisible();
    await doc.getByRole('button', { name: 'Assinar' }).click();
    await page.getByLabel('Sua senha').fill(E2E_PASSWORD);
    await page.getByLabel('Código de 6 dígitos').fill(await nextCode('doctor'));
    await page.getByRole('button', { name: 'Confirmar e assinar' }).click();
    await expect(doc.getByText('Conteúdo íntegro.')).toBeVisible();
    await expect(docs.locator('.timeline')).toContainText('Receita simples');
    await snap(page, '6-receita-assinada');
    const href = await doc.getByRole('link', { name: 'Abrir PDF' }).getAttribute('href');
    const pdf = await page.request.get(href ?? '');
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

    await page.getByRole('button', { name: 'Encerrar atendimento' }).click();
    await expect(page.getByText('Vínculo: Atendimento encerrado')).toBeVisible();
  });

  test('administrador verifica a trilha de auditoria', async ({ page }) => {
    await login(page, 'admin');
    await menu(page).getByRole('link', { name: 'Auditoria' }).click();
    await page.getByRole('button', { name: 'Verificar a trilha' }).click();
    await expect(page.getByRole('status')).toContainText('Trilha íntegra');
    await snap(page, '4-auditoria-verificada');
  });

  test('administrador cadastra médico, ficha profissional e agenda pelas telas', async ({
    page,
  }) => {
    // Os códigos de duas etapas não se repetem: pode ser preciso esperar a próxima janela.
    test.setTimeout(180_000);
    await login(page, 'admin');
    await menu(page).getByRole('link', { name: 'Configurações' }).click();

    await page.getByRole('button', { name: 'Novo usuário' }).click();
    const form = page.getByRole('form', { name: 'Novo usuário' });
    await form.getByLabel('Nome').fill('Dra. Helena Nova (fictícia)');
    await form.getByLabel('E-mail').fill(`helena.${Date.now()}@e2e-ficticia.test`);
    await form.getByLabel('Médico(a)').check();
    await form.getByLabel('Unidade Teste').check();
    await form.getByRole('button', { name: 'Criar usuário' }).click();
    // Criar conta exige confirmar a identidade.
    const dialog = page.getByRole('form', { name: 'Confirmar identidade' });
    await dialog.getByLabel('Sua senha').fill(E2E_PASSWORD);
    await dialog.getByLabel('Código de 6 dígitos').fill(await nextCode('admin'));
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('Senha temporária de Dra. Helena Nova (fictícia)')).toBeVisible();

    const ficha = page.getByRole('form', { name: 'Nova ficha profissional' });
    await ficha.getByLabel('Médico').selectOption({ label: 'Dra. Helena Nova (fictícia)' });
    await ficha.getByLabel('CRM', { exact: true }).fill('654321');
    await ficha.getByRole('button', { name: 'Criar ficha' }).click();
    await expect(page.getByText('Dra. Helena Nova (fictícia) · CRM 654321/SP')).toBeVisible();

    const nova = page.getByRole('form', { name: 'Nova agenda' });
    await nova.getByLabel('Profissional').selectOption({ label: 'Dra. Helena Nova (fictícia)' });
    await nova.getByRole('button', { name: 'Criar agenda' }).click();
    const agenda = page.getByLabel('Agenda de Dra. Helena Nova (fictícia)');
    await agenda.getByRole('button', { name: 'Adicionar faixa' }).click();
    await agenda.getByRole('button', { name: 'Salvar horários' }).click();
    await expect(agenda.getByRole('status')).toHaveText('Horários salvos.');
    await snap(page, '5-configuracoes');
  });
});
