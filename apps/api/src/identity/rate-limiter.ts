/**
 * Limite simples de tentativas por chave (ex.: IP) em janelas fixas, em memória.
 * Suficiente para um único servidor; com mais de um, mover para o banco.
 */
export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Registra uma tentativa e devolve `false` se o limite foi ultrapassado. */
  consume(key: string, nowMs: number): boolean {
    const entry = this.hits.get(key);
    if (!entry || nowMs - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: nowMs, count: 1 });
      this.prune(nowMs);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  private prune(nowMs: number): void {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) {
      if (nowMs - entry.windowStart >= this.windowMs) this.hits.delete(key);
    }
  }
}
