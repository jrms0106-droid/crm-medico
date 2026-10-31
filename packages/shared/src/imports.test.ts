import { describe, expect, it } from 'vitest';
import {
  PATIENT_IMPORT_MAX_ROWS,
  PATIENT_IMPORT_TEMPLATE,
  importDate,
  importRow,
  parseCsv,
  prepareImport,
} from './imports.js';

describe('parseCsv', () => {
  it('lê ponto e vírgula, aspas, aspas dobradas e quebra de linha dentro do campo', () => {
    const rows = parseCsv('\uFEFFnome;obs\r\n"Silva; Ana";"disse ""oi""\nna recepção"\n\nJoão;x\n');
    expect(rows).toEqual([
      { line: 1, cells: ['nome', 'obs'] },
      { line: 2, cells: ['Silva; Ana', 'disse "oi"\nna recepção'] },
      { line: 5, cells: ['João', 'x'] },
    ]);
  });

  it('detecta a vírgula como separador pelo cabeçalho', () => {
    expect(parseCsv('nome,cpf\nAna,123')).toEqual([
      { line: 1, cells: ['nome', 'cpf'] },
      { line: 2, cells: ['Ana', '123'] },
    ]);
  });
});

describe('prepareImport', () => {
  it('reconhece colunas sem diferença de maiúsculas e acentos e avisa as desconhecidas', () => {
    const prepared = prepareImport(
      'Nome;Data Nascimento;TELEFONE;Convênio\nAna;01/02/1990;11987654321;X',
    );
    expect(prepared).toEqual({
      ok: true,
      ignoredColumns: ['Convênio'],
      rows: [
        {
          line: 2,
          values: { nome: 'Ana', data_nascimento: '01/02/1990', telefone: '11987654321' },
        },
      ],
    });
  });

  it('recusa arquivo sem cabeçalho obrigatório, sem pacientes ou com linhas demais', () => {
    expect(prepareImport('nome;cpf\nAna;1')).toMatchObject({
      ok: false,
      message: expect.stringContaining('data_nascimento, telefone'),
    });
    expect(prepareImport('nome;data_nascimento;telefone\n')).toMatchObject({ ok: false });
    const many =
      'nome;data_nascimento;telefone\n' +
      'A;01/01/1990;11987654321\n'.repeat(PATIENT_IMPORT_MAX_ROWS + 1);
    expect(prepareImport(many)).toMatchObject({
      ok: false,
      message: expect.stringContaining('máximo'),
    });
  });
});

describe('importRow', () => {
  it('o modelo de planilha entra sem erro e sem nenhum consentimento', () => {
    const prepared = prepareImport(PATIENT_IMPORT_TEMPLATE);
    if (!prepared.ok) throw new Error(prepared.message);
    const { input, messages } = importRow(prepared.rows[0]!.values);
    expect(messages).toEqual([]);
    expect(input).toMatchObject({
      fullName: 'Maria Fictícia de Souza',
      birthDate: '1985-04-15',
      phones: [{ number: '11987654321', whatsapp: true }],
      address: { zip: '01001000', state: 'SP' },
      communication: { channels: [], appointmentReminders: false, marketing: false },
    });
  });

  it('aponta cada problema pela coluna', () => {
    const { input, messages } = importRow({
      nome: 'Jo',
      cpf: '111.111.111-11',
      data_nascimento: '31/02/1990',
      telefone: '123',
      telefone_whatsapp: 'talvez',
      email: 'sem-arroba',
      cep: '01001000',
    });
    expect(input).toBeNull();
    expect(messages).toEqual(
      expect.arrayContaining([
        'telefone_whatsapp: use sim ou não.',
        'nome: Informe ao menos 3 caracteres.',
        'cpf: CPF inválido.',
        'data_nascimento: data inexistente; use DD/MM/AAAA.',
        'telefone: Telefone inválido: use DDD + número.',
        'email: E-mail inválido.',
        expect.stringMatching(/^logradouro: /),
        expect.stringMatching(/^uf: /),
      ]),
    );
  });

  it('data em formato desconhecido e telefone ausente', () => {
    const { messages } = importRow({ nome: 'Ana Fictícia', data_nascimento: '1990/01/01' });
    expect(messages).toEqual([
      'data_nascimento: use DD/MM/AAAA.',
      'telefone: Informe ao menos um telefone.',
    ]);
  });

  it('converte datas', () => {
    expect(importDate('5/3/1990')).toBe('1990-03-05');
    expect(importDate('1990-03-05')).toBe('1990-03-05');
    expect(importDate('05-03-1990')).toBeNull();
  });
});
