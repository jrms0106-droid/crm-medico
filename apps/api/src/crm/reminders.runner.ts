import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_CONFIG } from '../config.tokens.js';
import type { AppConfig } from '../config.js';
import { PrismaService } from '../database/prisma.service.js';
import { RemindersService } from './reminders.service.js';

/** Trava do PostgreSQL: só uma instância da API roda a rotina por vez. */
const LOCK_KEY = 72_017_001;

/** Roda a rotina de lembretes a cada REMINDERS_INTERVAL_SECONDS (0 desliga). */
@Injectable()
export class RemindersRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Lembretes');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RemindersService) private readonly reminders: RemindersService,
  ) {}

  onModuleInit() {
    const seconds = this.config.REMINDERS_INTERVAL_SECONDS;
    if (seconds > 0) this.timer = setInterval(() => void this.tick(), seconds * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`;
          if (!lock?.ok) return;
          const r = await this.reminders.run();
          if (r.planned + r.sent + r.cancelled + r.failed > 0) {
            // Só contagens: nenhum dado do paciente vai para o log.
            this.logger.log(
              `planejados ${r.planned}, enviados ${r.sent}, cancelados ${r.cancelled}, falhas ${r.failed}`,
            );
          }
        },
        { timeout: 120_000 },
      );
    } catch (e) {
      this.logger.error(`Falha na rotina de lembretes: ${e instanceof Error ? e.name : 'erro'}`);
    } finally {
      this.running = false;
    }
  }
}
