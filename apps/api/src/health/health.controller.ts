import { Controller, Get, HttpCode, Inject } from '@nestjs/common';
import type { HealthResponse } from '@crm/shared';
import { PrismaService } from '../database/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Verifica se a API está no ar e se o banco responde. Não exige login nem expõe dados. */
  @Get()
  @HttpCode(200)
  async check(): Promise<HealthResponse> {
    let database: HealthResponse['database'] = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'unavailable';
    }
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      version: process.env['npm_package_version'] ?? '0.0.0',
      clinicalUseApproved: false,
    };
  }
}
