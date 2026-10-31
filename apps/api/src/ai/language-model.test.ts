import { type AdminReportMetrics, numbersIn } from '@crm/shared';
import { describe, expect, it } from 'vitest';
import { allowedNumbers } from './ai-insights.service.js';
import { type ScheduleFacts, simulatedReport, simulatedSchedule } from './language-model.js';

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
