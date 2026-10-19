import { describe, expect, it } from 'vitest';
import { fromLocal, toLocal, weekdayOf } from './time.js';

const SP = 'America/Sao_Paulo';

describe('hora local da unidade', () => {
  it('converte de UTC para a hora de São Paulo (UTC-3)', () => {
    expect(toLocal(new Date('2026-03-02T12:00:00Z'), SP)).toEqual({
      date: '2026-03-02',
      weekday: 1,
      minute: 9 * 60,
    });
    // 01:30 UTC ainda é o dia anterior em São Paulo.
    expect(toLocal(new Date('2026-03-03T01:30:00Z'), SP)).toEqual({
      date: '2026-03-02',
      weekday: 1,
      minute: 22 * 60 + 30,
    });
  });

  it('converte da hora local para UTC', () => {
    expect(fromLocal('2026-03-02', 8 * 60, SP).toISOString()).toBe('2026-03-02T11:00:00.000Z');
    expect(fromLocal('2026-03-02', 23 * 60, SP).toISOString()).toBe('2026-03-03T02:00:00.000Z');
    expect(fromLocal('2026-03-02', 24 * 60, SP).toISOString()).toBe('2026-03-03T03:00:00.000Z');
  });

  it('acerta fusos com horário de verão', () => {
    // Nova York: 9h local é 14h UTC no inverno e 13h UTC no verão.
    expect(fromLocal('2026-01-15', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
    expect(fromLocal('2026-07-15', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-07-15T13:00:00.000Z',
    );
  });

  it('calcula o dia da semana de uma data', () => {
    expect(weekdayOf('2026-03-01')).toBe(0);
    expect(weekdayOf('2026-03-07')).toBe(6);
  });
});
