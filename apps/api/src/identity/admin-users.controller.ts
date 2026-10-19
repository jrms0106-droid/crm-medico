import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ErrorCode, type UserAccountDto, userCreateSchema, userUpdateSchema } from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { parseBody } from '../common/validation.js';
import { Auth } from './auth.decorators.js';
import { AuthService } from './auth.service.js';
import type { AuthContext } from './session.service.js';
import { UserAdminService } from './user-admin.service.js';

const uuid = new ParseUUIDPipe();
const USER_NOT_FOUND = 'Usuário não encontrado.';

/** Cadastro de contas, papéis, unidades e recuperação de acesso, feitos pelo administrador. */
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(UserAdminService) private readonly users: UserAdminService,
  ) {}

  @Get()
  async list(@Auth() ctx: AuthContext): Promise<UserAccountDto[]> {
    await this.authz.authorize(ctx, 'view', { type: 'user_account' });
    return this.users.list(ctx.user.organizationId);
  }

  @Get(':id')
  async get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<UserAccountDto> {
    await this.authz.authorize(ctx, 'view', { type: 'user_account', id });
    return this.load(ctx, 'view', id);
  }

  @Post()
  async create(
    @Auth() ctx: AuthContext,
    @Body() body: unknown,
  ): Promise<{ user: UserAccountDto; temporaryPassword: string }> {
    await this.authz.authorize(ctx, 'create', { type: 'user_account' });
    this.authz.requireRecentReauth(ctx);
    return this.users.create(ctx.user.organizationId, parseBody(userCreateSchema, body));
  }

  @Patch(':id')
  async update(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<UserAccountDto> {
    await this.authz.authorize(ctx, 'edit', { type: 'user_account', id });
    const input = parseBody(userUpdateSchema, body);
    const target = await this.load(ctx, 'edit', id);
    if (this.users.changesAccess(target, input)) this.authz.requireRecentReauth(ctx);
    return this.users.update(ctx.user.id, target, ctx.user.organizationId, input);
  }

  @Post(':id/reset-access')
  @HttpCode(200)
  async resetAccess(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
  ): Promise<{ temporaryPassword: string }> {
    await this.loadOther(
      ctx,
      id,
      'Peça a outro administrador para redefinir o seu próprio acesso.',
    );
    return { temporaryPassword: await this.auth.resetAccess(id) };
  }

  @Post(':id/deactivate')
  @HttpCode(204)
  async deactivate(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<void> {
    await this.loadOther(ctx, id, 'Você não pode desativar a sua própria conta.');
    await this.auth.deactivate(id);
  }

  @Post(':id/reactivate')
  @HttpCode(204)
  async reactivate(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<void> {
    await this.loadOther(ctx, id, 'Peça a outro administrador para reativar a sua conta.');
    await this.users.reactivate(id);
  }

  private async load(ctx: AuthContext, action: 'view' | 'edit', id: string) {
    const target = await this.users.find(ctx.user.organizationId, id);
    return target ?? this.authz.notFound(ctx, action, 'user_account', id, USER_NOT_FOUND);
  }

  /**
   * Ações de acesso sobre outra pessoa: confere permissão antes de revelar se a conta existe,
   * exige reautenticação e só enxerga a própria organização.
   */
  private async loadOther(ctx: AuthContext, id: string, selfMessage: string) {
    await this.authz.authorize(ctx, 'edit', { type: 'user_account', id });
    this.authz.requireRecentReauth(ctx);
    const target = await this.load(ctx, 'edit', id);
    if (target.id === ctx.user.id) {
      throw new AppError(422, ErrorCode.BUSINESS_RULE_VIOLATION, selfMessage);
    }
    return target;
  }
}
