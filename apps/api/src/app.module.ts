import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthorizationService } from './authz/authorization.service.js';
import { Clock, SystemClock } from './common/clock.js';
import { APP_CONFIG } from './config.tokens.js';
import type { AppConfig } from './config.js';
import { PrismaService } from './database/prisma.service.js';
import { HealthController } from './health/health.controller.js';
import { AdminUsersController } from './identity/admin-users.controller.js';
import { AuthController } from './identity/auth.controller.js';
import { AuthGuard } from './identity/auth.guard.js';
import { AuthService } from './identity/auth.service.js';
import { SessionService } from './identity/session.service.js';

export interface AppOverrides {
  clock?: Clock;
}

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, AdminUsersController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: Clock, useValue: overrides.clock ?? new SystemClock() },
        { provide: PrismaService, useFactory: () => new PrismaService(config.DATABASE_URL) },
        SessionService,
        AuthService,
        AuthorizationService,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
