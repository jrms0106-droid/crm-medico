import { type DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from './config.js';
import { PrismaService } from './database/prisma.service.js';
import { HealthController } from './health/health.controller.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useFactory: () => new PrismaService(config.DATABASE_URL) },
      ],
    };
  }
}
