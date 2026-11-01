import { type AdminReportMetrics, numbersIn } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { allowedNumbers } from './ai-insights.service.js';
import {
  type RecordNotesFacts,
  type RecordSummaryFacts,
  type ScheduleFacts,
  simulatedRecordDraft,
  simulatedRecordSummary,
  simulatedReport,
  simulatedSchedule,
} from './language-model.js';

const metrics = (over: Partial<AdminReportMetrics> = {}): AdminReportMetrics => ({
  appointments: {
    total: 1234,
    scheduled: 40,
    confirmed: 200,
    arrived: 900,
    cancelled: 60,
    noShow: 34,
    rescheduled: 0,
    fitIn: 12,
  },
  noShowRate: 3.6,
  newPatients: 77,
  waiting: 5,
  reminders: { sent: 1100, failed: 3 },
  billing: { netCents: 12_345_678, receivedCents: 9_000_050, openCents: 0 },
  ...over,
});

describe('relatório simulado', () => {
  it('só cita números que o sistema calculou', () => {
    const m = metrics();
    const period = { from: '01/03/2026', to: '31/03/2026' };
    const text = simulatedReport(period, m);
    const allowed = allowedNumbers(m, [period.from, period.to]);
    for (const line of text) {
      for (const n of numbersIn(line)) expect(allowed.has(n), `${n} em "${line}"`).toBe(true);
    }
    expect(text.join(' ')).toMatch(/R\$\s123\.456,78 cobrados/);
    expect(text.join(' ')).toContain('1.234 consultas');
    expect(text.join(' ')).toContain('3,6%');
  });

  it('a conferência pega número inventado', () => {
    const allowed = allowedNumbers(metrics(), ['01/03/2026']);
    expect(numbersIn('Foram 1.235 consultas').every((n) => allowed.has(n))).toBe(false);
    expect(numbersIn('R$ 90.000,50 recebidos').every((n) => allowed.has(n))).toBe(true);
  });

  it('sem base de comparecimento não fala em taxa de faltas', () => {
    const m = metrics({ noShowRate: null });
    expect(simulatedReport({ from: 'a', to: 'b' }, m).join(' ')).not.toMatch(/taxa/);
  });
});

describe('agenda simulada', () => {
  const facts: ScheduleFacts = {
    date: '03/03/2026',
    slots: [
      { code: 'H1', time: '08:00', period: 'manhã' },
      { code: 'H2', time: '14:00', period: 'tarde' },
    ],
    waitlist: [
      { code: 'E1', sameDoctor: false, waitingDays: 30, preference: 'só à tarde' },
      { code: 'E2', sameDoctor: false, waitingDays: 40, preference: 'Manhã, por favor' },
      { code: 'E3', sameDoctor: true, waitingDays: 1, preference: 'tarde' },
    ],
    unconfirmed: [{ code: 'C1', time: '10:00' }],
  };

  it('dá prioridade a quem pediu o médico, respeita o período e não repete ninguém', () => {
    const out = simulatedSchedule(facts);
    expect(out.suggestions).toEqual([
      expect.objectContaining({ kind: 'fill_slot', slot: 'H1', waitlist: 'E2' }),
      expect.objectContaining({ kind: 'fill_slot', slot: 'H2', waitlist: 'E3' }),
      expect.objectContaining({ kind: 'confirm', appointment: 'C1' }),
    ]);
  });

  it('não passa de 10 sugestões', () => {
    const many: ScheduleFacts = {
      ...facts,
      waitlist: [],
      unconfirmed: Array.from({ length: 15 }, (_, i) => ({ code: `C${i + 1}`, time: '10:00' })),
    };
    expect(simulatedSchedule(many).suggestions).toHaveLength(10);
  });
});

describe('organização simulada das anotações', () => {
  const facts = (texts: string[]): RecordNotesFacts => ({
    sentences: texts.map((text, i) => ({ code: `S${i + 1}`, text })),
  });

  it('conduta, exame e motivo vão para o campo certo; o resto vai para a anamnese', () => {
    const out = simulatedRecordDraft(
      facts([
        'Nega febre.',
        'Queixa de dor de garganta há três dias.',
        'Ao exame, orofaringe hiperemiada.',
        'Oriento hidratação e retorno se piorar.',
        'Mora com a filha.',
      ]),
    );
    expect(out.fields).toEqual({
      chiefComplaint: ['S2'],
      anamnesis: ['S1', 'S5'],
      physicalExam: ['S3'],
      plan: ['S4'],
    });
  });

  it('sem palavra de motivo, a primeira frase restante vira o motivo', () => {
    const out = simulatedRecordDraft(facts(['Dor lombar.', 'Piora ao sentar.']));
    expect(out.fields.chiefComplaint).toEqual(['S1']);
    expect(out.fields.anamnesis).toEqual(['S2']);
  });
});

describe('resumo simulado do prontuário', () => {
  it('pega o primeiro motivo e a primeira conduta de cada registro, até 12 itens', () => {
    const record = (r: number): RecordSummaryFacts['records'][number] => ({
      code: `R${r}`,
      fields: {
        chiefComplaint: [{ code: `R${r}.S1`, text: 'Motivo.' }],
        anamnesis: [{ code: `R${r}.S2`, text: 'História.' }],
        plan: [
          { code: `R${r}.S3`, text: 'Conduta.' },
          { code: `R${r}.S4`, text: 'Outra.' },
        ],
      },
    });
    const one = simulatedRecordSummary({ records: [record(1)] });
    expect(one.items).toEqual([
      { field: 'chiefComplaint', refs: ['R1.S1'] },
      { field: 'plan', refs: ['R1.S3'] },
    ]);
    const many = simulatedRecordSummary({ records: [1, 2, 3, 4, 5, 6, 7].map(record) });
    expect(many.items).toHaveLength(12);
  });
});
