import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemClock } from './clock.js';

describe('SystemClock', () => {
  afterEach(() => vi.useRealTimers());

  it('sem deslocamento devolve o horário do sistema', () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T02:30:00.000Z') });
    expect(new SystemClock().now().toISOString()).toBe('2026-11-02T02:30:00.000Z');
  });

  it('com deslocamento soma os milissegundos ao horário do sistema', () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T02:30:00.000Z') });
    const clock = new SystemClock(10.5 * 3_600_000);
    expect(clock.now().toISOString()).toBe('2026-11-02T13:00:00.000Z');
    vi.advanceTimersByTime(60_000);
    expect(clock.now().toISOString()).toBe('2026-11-02T13:01:00.000Z');
  });
});
