import { createHash } from 'node:crypto';
import type { PrismaService } from '../database/prisma.service.js';

/**
 * Limite de tentativas por chave (ex.: IP) em janelas fixas, guardado no banco
 * (`identity.login_rate_limits`). Vale para várias instâncias da API ao mesmo tempo, porque a
 * contagem é feita numa única instrução atômica. A chave é guardada como SHA-256, nunca o IP.
 */
export class DbRateLimiter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Registra uma tentativa e devolve `false` se o limite foi ultrapassado. */
  async consume(key: string, now: Date): Promise<boolean> {
    const keyHash = createHash('sha256').update(key, 'utf8').digest('hex');
    const expired = new Date(now.getTime() - this.windowMs);
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO identity.login_rate_limits AS r (key_hash, window_start, count)
      VALUES (${keyHash}, ${now}, 1)
      ON CONFLICT (key_hash) DO UPDATE SET
        count = CASE WHEN r.window_start <= ${expired} THEN 1 ELSE r.count + 1 END,
        window_start = CASE WHEN r.window_start <= ${expired} THEN ${now} ELSE r.window_start END
      RETURNING r.count`;
    const count = rows[0]?.count ?? 1;
    // Janela nova: aproveita para apagar as janelas vencidas de todas as chaves.
    if (count === 1) {
      await this.prisma.loginRateLimit.deleteMany({ where: { windowStart: { lte: expired } } });
    }
    return count <= this.limit;
  }
}
