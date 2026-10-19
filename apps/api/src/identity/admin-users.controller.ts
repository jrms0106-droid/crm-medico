import { Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ErrorCode } from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../database/prisma.service.js';
import { Auth } from './auth.decorators.js';
import { AuthService } from './auth.service.js';
import type { AuthContext } from './session.service.js';

/** Recuperação e bloqueio de acesso feitos por administrador. O cadastro completo vem na Etapa 2. */
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Post(':id/reset-access')
  @HttpCode(200)
  async resetAccess(
    @Auth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ temporaryPassword: string }> {
    await this.loadTarget(ctx, id);
    return { temporaryPassword: await this.auth.resetAccess(id) };
  }

  @Post(':id/deactivate')
  @HttpCode(204)
  async deactivate(
    @Auth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.loadTarget(ctx, id);
    await this.auth.deactivate(id);
  }

  /** Confere permissão antes de revelar se o usuário existe; só enxerga a própria organização. */
  private async loadTarget(ctx: AuthContext, id: string) {
    this.authz.assert(ctx, 'edit', { type: 'user_access', dataClass: 'administrative' });
    const target = await this.prisma.user.findFirst({
      where: { id, organizationId: ctx.user.organizationId },
    });
    if (!target) throw new AppError(404, ErrorCode.NOT_FOUND, 'Usuário não encontrado.');
    if (target.id === ctx.user.id) {
      throw new AppError(
        422,
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Peça a outro administrador para redefinir o seu próprio acesso.',
      );
    }
    return target;
  }
}
