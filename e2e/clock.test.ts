import { describe, expect, it } from 'vitest';
import { offsetToNextStart } from './clock.js';

const at = (iso: string, minutes: number) =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

describe('offsetToNextStart', () => {
  it('perto da meia-noite de Brasília pula para as 10:00 do dia seguinte', () => {
    // 23:50 de 01/11 em Brasília = 02:50 UTC de 02/11.
    const now = '2026-11-02T02:50:00.000Z';
    const minutes = offsetToNextStart(new Date(now));
    expect(at(now, minutes)).toBe('2026-11-02T13:00:00.000Z');
  });

  it('de madrugada vai para as 10:00 do mesmo dia', () => {
    const now = '2026-11-02T06:15:00.000Z'; // 03:15 em Brasília
    expect(at(now, offsetToNextStart(new Date(now)))).toBe('2026-11-02T13:00:00.000Z');
  });

  it('logo depois das 10:00 vai para as 10:00 do dia seguinte e nunca volta no tempo', () => {
    const now = '2026-11-02T13:00:30.000Z'; // 10:00:30 em Brasília
    const minutes = offsetToNextStart(new Date(now));
    expect(minutes).toBeGreaterThanOrEqual(0);
    expect(minutes).toBeLessThanOrEqual(24 * 60);
    expect(at(now, minutes).slice(0, 16)).toBe('2026-11-03T13:00');
  });

  it('exatamente às 10:00 não desloca', () => {
    expect(offsetToNextStart(new Date('2026-11-02T13:00:00.000Z'))).toBe(0);
  });
});
