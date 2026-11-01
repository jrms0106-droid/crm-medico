import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
      'Financeiro',
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
      'Financeiro',
      'Lembretes',
      'Direitos do paciente',
      'Importar pacientes',
      'Assistente (IA)',
      'Profissionais',
    ]);
    await page.goto('/#/auditoria');
    await expect(page.getByText('Esta área não faz parte do seu perfil.')).toBeVisible();
  });

  test('secretária cadastra o paciente, marca a consulta e registra a chegada', async ({
    page,
  }) => {
    await login(page, 'secretary');
    await menu(page).getByRole('link', { name: 'Pacientes', exact: true }).click();
    await page.getByRole('button', { name: 'Novo paciente' }).click();
    await page.getByLabel('Nome completo').fill(PATIENT);
    await page.getByLabel('Data de nascimento').fill('1985-04-12');
    await page.getByLabel('Telefone com DDD').fill('11987654321');
    await page.getByLabel('Este telefone tem WhatsApp').check();
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

    // Cópia pedida pelo paciente: a senha acabou de ser confirmada na assinatura, então não pede
    // de novo; o arquivo traz o registro e a receita assinados.
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Cópia do prontuário' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^copia-do-prontuario-\d{4}-\d{2}-\d{2}\.json$/);
    const copy = JSON.parse(await readFile(await download.path(), 'utf8')) as {
      records: { status: string }[];
      documents: { kind: string }[];
    };
    expect(copy.records.map((r) => r.status)).toEqual(['signed']);
    expect(copy.documents.map((d) => d.kind)).toEqual(['prescription']);
    await expect(page.getByRole('status')).toContainText('Cópia gerada com 1 registro(s)');

    // A mesma cópia no padrão FHIR (docs/api/integracoes.md).
    const downloadingFhir = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Cópia no padrão FHIR' }).click();
    const fhirFile = await downloadingFhir;
    expect(fhirFile.suggestedFilename()).toMatch(
      /^copia-do-prontuario-fhir-\d{4}-\d{2}-\d{2}\.json$/,
    );
    const bundle = JSON.parse(await readFile(await fhirFile.path(), 'utf8')) as {
      resourceType: string;
      entry: { resource: { resourceType: string } }[];
    };
    expect(bundle.resourceType).toBe('Bundle');
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types.filter((x) => x === 'Composition')).toHaveLength(1);
    expect(types.filter((x) => x === 'DocumentReference')).toHaveLength(1);
    await expect(page.getByRole('status')).toContainText('Cópia no padrão FHIR gerada');
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
    test.setTimeout(300_000);
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

  test('financeiro: administrador cria o preço, secretária cobra e recebe, administrador estorna', async ({
    page,
  }) => {
    // Quatro códigos de MFA novos (cada um pode esperar até 30 s pela próxima janela) e o fluxo.
    test.setTimeout(300_000);
    await login(page, 'admin');
    await menu(page).getByRole('link', { name: 'Configurações' }).click();
    const item = page.getByRole('form', { name: 'Novo item da tabela' });
    await item.getByLabel('Novo item').fill('Consulta particular');
    await item.getByLabel('Valor (R$)').fill('250,00');
    await item.getByRole('button', { name: 'Adicionar item' }).click();
    await expect(page.getByText('Consulta particular: R$ 250,00')).toBeVisible();
    await page.getByRole('button', { name: 'Sair' }).click();

    // A secretária cobra a consulta pela agenda, com desconto, e recebe em duas partes.
    await login(page, 'secretary');
    await menu(page).getByRole('link', { name: 'Agenda' }).click();
    await page
      .getByRole('row', { name: new RegExp(PATIENT) })
      .getByRole('link', { name: 'Cobrar' })
      .click();
    const nova = page.getByRole('form', { name: 'Nova cobrança' });
    await nova.getByLabel('Item da tabela').selectOption({ index: 1 });
    await expect(nova.getByLabel('Valor (R$)')).toHaveValue('250,00');
    await nova.getByLabel('Desconto (R$, opcional)').fill('50');
    await nova.getByRole('button', { name: 'Criar cobrança' }).click();

    const row = page.getByRole('row', { name: new RegExp(PATIENT) }).first();
    await expect(row).toContainText('R$ 200,00');
    await expect(row).toContainText('Em aberto');
    await row.getByRole('button', { name: 'Abrir' }).click();
    const pay = page.getByRole('form', { name: 'Registrar pagamento' });
    await expect(pay.getByLabel('Valor recebido (R$)')).toHaveValue('200,00');
    await pay.getByLabel('Forma').selectOption({ label: 'Pix' });
    await pay.getByLabel('Valor recebido (R$)').fill('120,00');
    await pay.getByRole('button', { name: 'Registrar pagamento' }).click();
    await expect(pay.getByRole('status')).toHaveText('Pagamento de R$ 120,00 registrado.');
    await expect(row).toContainText('Pago em parte');
    await expect(pay.getByLabel('Valor recebido (R$)')).toHaveValue('80,00');
    await pay.getByLabel('Forma').selectOption({ label: 'Dinheiro' });
    await pay.getByRole('button', { name: 'Registrar pagamento' }).click();
    await expect(row).toContainText('Quitada');
    await expect(page.getByLabel('Resumo financeiro')).toContainText('R$ 200,00');
    await snap(page, '8-financeiro-secretaria');
    await page.getByRole('button', { name: 'Sair' }).click();

    // Só o administrador estorna, com motivo e confirmação de identidade.
    await login(page, 'admin');
    await menu(page).getByRole('link', { name: 'Financeiro' }).click();
    const adminRow = page.getByRole('row', { name: new RegExp(PATIENT) }).first();
    await adminRow.getByRole('button', { name: 'Abrir' }).click();
    await expect(page.getByRole('form', { name: 'Registrar pagamento' })).toHaveCount(0);
    page.once('dialog', (d) => void d.accept('Registrado na forma errada'));
    await page
      .getByRole('list', { name: 'Pagamentos' })
      .getByRole('button', { name: 'Estornar' })
      .first()
      .click();
    const dialog = page.getByRole('form', { name: 'Confirmar identidade' });
    await dialog.getByLabel('Sua senha').fill(E2E_PASSWORD);
    await dialog.getByLabel('Código de 6 dígitos').fill(await nextCode('admin'));
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.getByText('Registrado na forma errada')).toBeVisible();
    await expect(adminRow).toContainText('Pago em parte');
    await expect(adminRow).toContainText('R$ 120,00');
    await snap(page, '9-financeiro-estorno');
    await page.getByRole('button', { name: 'Sair' }).click();

    // O médico não vê o financeiro, nem digitando o endereço.
    await login(page, 'doctor');
    await expect(menu(page).getByRole('link', { name: 'Financeiro' })).toHaveCount(0);
    await page.goto('/#/financeiro');
    await expect(page.getByText('Esta área não faz parte do seu perfil.')).toBeVisible();
    await page.goto('/#/direitos');
    await expect(page.getByText('Esta área não faz parte do seu perfil.')).toBeVisible();
    await page.goto('/#/lembretes');
    await expect(page.getByText('Esta área não faz parte do seu perfil.')).toBeVisible();
  });

  test('direitos do paciente: secretária registra o pedido, vê os acessos, exporta e responde', async ({
    page,
  }) => {
    await login(page, 'secretary');
    await menu(page).getByRole('link', { name: 'Pacientes', exact: true }).click();
    await page.getByLabel('Buscar por nome, CPF ou telefone').fill(PATIENT);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.getByRole('link', { name: PATIENT }).click();
    await page.getByRole('link', { name: 'Registrar pedido' }).click();

    const nova = page.getByRole('form', { name: 'Novo pedido do paciente' });
    await nova
      .getByLabel('O que o paciente pediu')
      .selectOption({ label: 'Relatório de quem acessou' });
    await nova.getByLabel('Detalhes (opcional)').fill('Pediu na recepção, por escrito.');
    await nova.getByRole('button', { name: 'Registrar pedido' }).click();
    const row = page.getByRole('row', { name: new RegExp(PATIENT) }).first();
    await expect(row).toContainText('Relatório de quem acessou');
    await expect(row).toContainText('Aberto');

    // Na ficha: o relatório mostra quem acessou (o médico atendeu no teste anterior), sem conteúdo.
    await row.getByRole('link', { name: PATIENT }).click();
    await page.getByRole('button', { name: 'Relatório de acessos' }).click();
    const acessos = page.getByRole('table', { name: 'Acessos aos dados do paciente' });
    await expect(acessos).toContainText(USERS.secretary.name);
    await expect(acessos).toContainText(USERS.doctor.name);
    await expect(acessos).toContainText('Registro do prontuário');
    await snap(page, '10-relatorio-de-acessos');

    // Exportar exige a senha de novo; o arquivo é JSON, sem a parte clínica.
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar dados' }).click();
    const dialog = page.getByRole('form', { name: 'Confirmar identidade' });
    await dialog.getByLabel('Sua senha').fill(E2E_PASSWORD);
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^dados-do-paciente-\d{4}-\d{2}-\d{2}\.json$/);
    const file = await download.path();
    const exported = JSON.parse(await readFile(file, 'utf8')) as {
      patient: { fullName: string };
      subjectRequests: unknown[];
      clinical: { included: boolean };
    };
    expect(exported.patient.fullName).toBe(PATIENT);
    expect(exported.subjectRequests).toHaveLength(1);
    expect(exported.clinical.included).toBe(false);
    await expect(page.getByRole('status')).toContainText('Arquivo gerado.');

    // A resposta é registrada uma vez e não pode ser desfeita.
    await page.getByRole('button', { name: 'Responder' }).click();
    const resposta = page.getByRole('form', { name: 'Responder pedido' });
    await resposta.getByLabel('Resposta dada ao paciente').fill('Relatório entregue impresso.');
    page.once('dialog', (d) => void d.accept());
    await resposta.getByRole('button', { name: 'Registrar resposta' }).click();
    const panel = page.getByRole('table', { name: 'Pedidos do paciente' });
    await expect(panel).toContainText('Atendido');
    await expect(panel).toContainText('Relatório entregue impresso.');
    await expect(page.getByRole('button', { name: 'Responder' })).toHaveCount(0);
    await snap(page, '11-direitos-na-ficha');
  });

  test('lembretes: secretária registra a autorização do paciente e vê a fila', async ({ page }) => {
    await login(page, 'secretary');
    await menu(page).getByRole('link', { name: 'Pacientes', exact: true }).click();
    await page.getByLabel('Buscar por nome, CPF ou telefone').fill(PATIENT);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.getByRole('link', { name: PATIENT }).click();
    const panel = page.locator('.panel', {
      has: page.getByRole('heading', { name: 'Lembretes por WhatsApp' }),
    });
    await expect(panel).toContainText('Não autorizado');
    await panel.getByRole('button', { name: 'Registrar autorização' }).click();
    await expect(panel).toContainText('Autorizado');
    await expect(panel).toContainText('O paciente recebe lembrete antes das consultas.');
    await snap(page, '12-lembretes-na-ficha');
    // A autorização fica no cadastro: recarregar mostra o mesmo estado.
    await page.reload();
    await expect(panel).toContainText('O paciente recebe lembrete antes das consultas.');

    await menu(page).getByRole('link', { name: 'Lembretes' }).click();
    await expect(page.getByRole('heading', { name: 'Lembretes' })).toBeVisible();
    await expect(page.getByText(/Envio simulado/)).toBeVisible();
  });

  test('importação: secretária confere a planilha e importa só a linha boa', async ({ page }) => {
    const name = `Importada Fictícia ${Date.now()}`;
    // Telefone aleatório para não parecer duplicidade de execuções anteriores.
    const phone = `119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const csv =
      'nome;data_nascimento;telefone;telefone_whatsapp\n' +
      `${name};07/08/1977;${phone};sim\n` +
      'Sem Data Fictícia;;11900000000;não\n';
    await login(page, 'secretary');
    await menu(page).getByRole('link', { name: 'Importar pacientes' }).click();
    await page.getByLabel('Planilha (CSV)').setInputFiles({
      name: 'pacientes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf8'),
    });
    await page.getByRole('button', { name: 'Conferir planilha' }).click();
    const lines = page.getByRole('table', { name: 'Linhas da planilha' });
    await expect(page.getByRole('status')).toContainText('1 linha(s) pronta(s) para entrar');
    await expect(lines).toContainText('data_nascimento: use DD/MM/AAAA.');
    await snap(page, '13-importacao-conferida');
    await page.getByRole('button', { name: 'Importar 1 paciente(s)' }).click();
    await expect(page.getByRole('status')).toContainText('1 paciente(s) cadastrado(s)');
    await lines.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
  });

  test('assistente de IA: administrador liga, secretária classifica, escreve e revisa', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await login(page, 'admin');
    await menu(page).getByRole('link', { name: 'Configurações' }).click();
    const ai = page.locator('.panel', {
      has: page.getByRole('heading', { name: /Assistente de IA/ }),
    });
    await ai
      .getByRole('listitem')
      .filter({ hasText: 'Classificação' })
      .getByRole('button', { name: 'Ligar' })
      .click();
    const dialog = page.getByRole('form', { name: 'Confirmar identidade' });
    await dialog.getByLabel('Sua senha').fill(E2E_PASSWORD);
    await dialog.getByLabel('Código de 6 dígitos').fill(await nextCode('admin'));
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(ai.getByRole('listitem').filter({ hasText: 'Classificação' })).toContainText(
      'Ligado',
    );
    // A reautenticação ainda vale: o segundo interruptor não pede a senha de novo.
    await ai
      .getByRole('listitem')
      .filter({ hasText: 'Rascunho' })
      .getByRole('button', { name: 'Ligar' })
      .click();
    await expect(ai.getByRole('listitem').filter({ hasText: 'Rascunho' })).toContainText('Ligado');
    for (const label of ['Organização da agenda', 'Relatório administrativo']) {
      const item = ai.getByRole('listitem').filter({ hasText: label });
      await item.getByRole('button', { name: 'Ligar' }).click();
      await expect(item).toContainText('Ligado');
    }
    await page.getByRole('button', { name: 'Sair' }).click();

    await login(page, 'secretary');
    await menu(page).getByRole('link', { name: 'Assistente (IA)' }).click();
    const triage = page.getByRole('form', { name: 'Classificar pedido' });
    await triage
      .getByLabel('Mensagem do paciente')
      .fill('Estou com dor no peito desde cedo, posso ir hoje?');
    await triage.getByRole('button', { name: 'Classificar' }).click();
    await expect(page.getByText('Dúvida de saúde (passar ao médico)')).toBeVisible();
    // O aviso de sinal de alerta é lido pelo leitor de tela assim que aparece (papel alert).
    await expect(page.getByRole('alert').filter({ hasText: /ligar 192/ })).toBeVisible();
    await expect(page.getByText(/modelo simulado/).first()).toBeVisible();
    await snap(page, '14-assistente-classificacao');
    await page.getByRole('button', { name: 'Copiar e marcar como usado' }).click();
    await expect(page.getByText('Texto copiado e marcado como usado.')).toBeVisible();
    const history = page.getByRole('table', { name: 'Usos do assistente' });
    await expect(history).toContainText('Usado');

    await menu(page).getByRole('link', { name: 'Agenda' }).click();
    // O nome acessível do campo inclui a opção escolhida, então o campo é achado pelo rótulo.
    await page
      .locator('label.field', { has: page.getByText('Agenda', { exact: true }) })
      .locator('select')
      .selectOption({ label: USERS.doctor.name });
    const row = page.getByRole('row', { name: new RegExp(PATIENT) }).first();
    await row.getByRole('button', { name: 'Mensagem (IA)' }).click();
    const draft = page.getByRole('form', { name: 'Rascunho de mensagem' });
    await draft.getByLabel('Motivo').selectOption({ label: 'Falta na consulta' });
    await draft.getByRole('button', { name: 'Gerar rascunho' }).click();
    const text = page.getByLabel('Sugestão (revise e edite antes de usar)');
    await expect(text).toHaveValue(
      new RegExp(
        `Sentimos sua falta na consulta com ${USERS.doctor.name.replace(/[()]/g, '\\$&')}`,
      ),
    );
    await page.getByRole('button', { name: 'Descartar' }).click();
    await expect(page.getByText('Sugestão descartada.')).toBeVisible();

    // Organização do dia: só fatos conferidos pelo sistema; nada é marcado sozinho.
    const organize = page.locator('.panel', {
      has: page.getByRole('heading', { name: 'Organizar o dia (IA)' }),
    });
    await organize.getByRole('button', { name: 'Sugerir organização do dia' }).click();
    await expect(organize.getByText(/Conferido pelo sistema/)).toBeVisible();
    await expect(organize.getByText(/modelo simulado/)).toBeVisible();
    await snap(page, '15-assistente-agenda');
    await organize.getByRole('button', { name: 'Marcar como útil' }).click();
    await expect(organize.getByText('Marcado como útil.')).toBeVisible();
    await page.getByRole('button', { name: 'Sair' }).click();

    // Relatório assistido: o administrador gera no Financeiro, com os números ao lado.
    await login(page, 'admin');
    await menu(page).getByRole('link', { name: 'Financeiro' }).click();
    const report = page.locator('.panel', {
      has: page.getByRole('heading', { name: 'Resumo assistido do período (IA)' }),
    });
    await report.getByRole('button', { name: 'Gerar resumo assistido' }).click();
    await expect(report.getByRole('table', { name: 'Números do período' })).toBeVisible();
    await expect(report.getByLabel('Sugestão (revise e edite antes de usar)')).toHaveValue(
      /Financeiro particular:/,
    );
    await snap(page, '16-assistente-relatorio');
    await report.getByRole('button', { name: 'Copiar e marcar como usado' }).click();
    await expect(report.getByText('Texto copiado e marcado como usado.')).toBeVisible();
  });
  test('assistente clínico: médico resume o prontuário e organiza anotações no rascunho', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await login(page, 'admin');
    await menu(page).getByRole('link', { name: 'Configurações' }).click();
    const ai = page.locator('.panel', {
      has: page.getByRole('heading', { name: /Assistente de IA/ }),
    });
    const draftSwitch = ai.getByRole('listitem').filter({ hasText: 'Organizar anotações' });
    await draftSwitch.getByRole('button', { name: 'Ligar' }).click();
    const dialog = page.getByRole('form', { name: 'Confirmar identidade' });
    await dialog.getByLabel('Sua senha').fill(E2E_PASSWORD);
    await dialog.getByLabel('Código de 6 dígitos').fill(await nextCode('admin'));
    await dialog.getByRole('button', { name: 'Confirmar' }).click();
    await expect(draftSwitch).toContainText('Ligado');
    const summarySwitch = ai.getByRole('listitem').filter({ hasText: 'Resumo do prontuário' });
    await summarySwitch.getByRole('button', { name: 'Ligar' }).click();
    await expect(summarySwitch).toContainText('Ligado');
    await page.getByRole('button', { name: 'Sair' }).click();

    // Nova consulta da mesma paciente, para o médico ter um atendimento iniciado.
    await login(page, 'secretary');
    await menu(page).getByRole('link', { name: 'Pacientes', exact: true }).click();
    await page.getByLabel('Buscar por nome, CPF ou telefone').fill(PATIENT);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    await page.getByRole('link', { name: PATIENT }).first().click();
    await page.getByRole('link', { name: 'Agendar consulta' }).click();
    await page.locator('.slot').first().click();
    await page.getByRole('button', { name: 'Agendar' }).click();
    await expect(page.getByRole('status')).toContainText('Consulta marcada');
    const booked = page
      .getByRole('row', { name: new RegExp(PATIENT) })
      .filter({ hasText: 'Agendada' });
    await booked.getByRole('button', { name: 'Registrar chegada' }).click();
    await expect(booked).toHaveCount(0);
    await page.getByRole('button', { name: 'Sair' }).click();

    await login(page, 'doctor');
    await menu(page).getByRole('link', { name: 'Agenda' }).click();
    await page
      .getByRole('row', { name: new RegExp(PATIENT) })
      .filter({ hasText: 'Paciente chegou' })
      .last()
      .getByRole('button', { name: 'Iniciar atendimento' })
      .click();
    await expect(page.getByText('Vínculo: Atendimento iniciado')).toBeVisible();

    // Resumo: só trechos dos registros assinados, cada um com a fonte.
    const summary = page.locator('.panel', {
      has: page.getByRole('heading', { name: 'Resumo com fontes (IA)' }),
    });
    await summary.getByRole('button', { name: 'Gerar resumo' }).click();
    await expect(summary.getByText('Dor de cabeça há dois dias (fictício).')).toBeVisible();
    await expect(summary.getByText(/Fonte: Consulta de/).first()).toBeVisible();
    await expect(summary.getByText(/não é guardado/)).toBeVisible();
    await snap(page, '17-assistente-resumo-prontuario');
    await summary.getByRole('button', { name: 'Marcar como útil' }).click();
    await expect(summary.getByText('Marcado como útil.')).toBeVisible();
    await summary.getByRole('button', { name: 'Abrir registro' }).first().click();
    await expect(page.getByText('Conteúdo íntegro.')).toBeVisible();

    // Organização das anotações: as frases do médico, sem mudar uma letra, no rascunho.
    await page.getByRole('button', { name: 'Novo registro' }).click();
    await page.getByRole('button', { name: 'Organizar anotações nos campos' }).click();
    await page
      .getByLabel('Suas anotações da consulta')
      .fill(
        'Queixa de cansaço leve (fictício). Ao exame, afebril. Oriento manter hidratação. ' +
          'Dorme bem.',
      );
    await page.getByRole('button', { name: 'Organizar', exact: true }).click();
    const suggestion = page.getByLabel('Sugestão de organização');
    await expect(suggestion.getByText(/não preenche hipóteses nem CID/)).toBeVisible();
    await snap(page, '18-assistente-anotacoes');
    await suggestion.getByRole('button', { name: 'Inserir no registro' }).click();
    await expect(page.getByText(/Texto inserido no rascunho/)).toBeVisible();
    await expect(page.getByLabel('Motivo da consulta')).toHaveValue(
      'Queixa de cansaço leve (fictício).',
    );
    await expect(page.getByLabel('Exame físico')).toHaveValue('Ao exame, afebril.');
    await expect(page.getByLabel('Conduta')).toHaveValue('Oriento manter hidratação.');
    await expect(page.getByLabel('Anamnese')).toHaveValue('Dorme bem.');

    // Limpeza: descarta o rascunho e encerra o atendimento.
    page.once('dialog', (d) => void d.accept());
    await page
      .getByRole('form', { name: 'Editar rascunho' })
      .getByRole('button', { name: 'Descartar', exact: true })
      .click();
    await page.getByRole('button', { name: 'Encerrar atendimento' }).click();
    await expect(page.getByText('Vínculo: Atendimento encerrado')).toBeVisible();
  });

  test('acessibilidade: telas de cada perfil sem violações WCAG 2.1 A/AA (axe)', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const problems: string[] = [];
    const scanned: string[] = [];
    const scan = async (where: string) => {
      scanned.push(where);
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      for (const v of result.violations) {
        const targets = v.nodes.map((n) => n.target.join(' ')).slice(0, 3);
        problems.push(`${where}: [${v.impact}] ${v.id} (${v.nodes.length}) ${targets.join(' | ')}`);
      }
    };
    await page.goto('/');
    await expect(page.getByLabel('E-mail')).toBeVisible();
    await scan('login');
    for (const user of ['secretary', 'doctor', 'admin'] as const) {
      await login(page, user);
      if (user === 'secretary') {
        // Atalho de teclado para pular o menu, e título da aba conforme a tela.
        await page.keyboard.press('Tab');
        await expect(page.getByRole('link', { name: 'Pular para o conteúdo' })).toBeFocused();
        await menu(page).getByRole('link', { name: 'Agenda', exact: true }).click();
        await expect(page).toHaveTitle('Agenda · CRM Médico');
        await expect(page.locator('main#conteudo')).toBeFocused();
      }
      const links = await menu(page).getByRole('link').allTextContents();
      for (const name of links) {
        await menu(page).getByRole('link', { name, exact: true }).click();
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await scan(`${user} › ${name}`);
      }
      await page.getByRole('button', { name: 'Sair' }).click();
    }
    test.info().annotations.push({ type: 'axe', description: scanned.join(', ') });
    expect(scanned.length).toBeGreaterThan(15);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
