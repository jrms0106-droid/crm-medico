/**
 * Conversão entre hora local da unidade e UTC, usando o banco de fusos do próprio Node (Intl).
 * As faixas de atendimento são guardadas em minutos desde a meia-noite local.
 */

export interface LocalTime {
  /** Data local, AAAA-MM-DD. */
  date: string;
  /** 0 = domingo ... 6 = sábado. */
  weekday: number;
  /** Minutos desde a meia-noite local. */
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function parts(instant: Date, timeZone: string) {
  const values: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') values[p.type] = Number(p.value);
  }
  return values as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** Diferença, em milissegundos, entre a hora local do fuso e o UTC naquele instante. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function toLocal(instant: Date, timeZone: string): LocalTime {
  const p = parts(instant, timeZone);
  const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return {
    date,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    minute: p.hour * 60 + p.minute,
  };
}

/** Instante UTC de uma data local (AAAA-MM-DD) mais `minute` minutos desde a meia-noite. */
export function fromLocal(date: string, minute: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minute);
  const first = guess - offsetMs(new Date(guess), timeZone);
  // Recalcula com o fuso do resultado, para acertar dias de troca de horário de verão.
  return new Date(guess - offsetMs(new Date(first), timeZone));
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
