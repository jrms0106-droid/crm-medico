import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  type ProfessionalDto,
  professionalCreateSchema,
  professionalUpdateSchema,
} from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { OrgService } from './org.service.js';

const uuid = new ParseUUIDPipe();
const NOT_FOUND = 'Profissional não encontrado.';

@Controller('professionals')
export class ProfessionalsController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(OrgService) private readonly org: OrgService,
  ) {}

  @Get()
  async list(@Auth() ctx: AuthContext): Promise<ProfessionalDto[]> {
    await this.authz.authorize(ctx, 'view', { type: 'professional' });
    return this.org.listProfessionals(ctx.user.organizationId);
  }

  @Get(':id')
  async get(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<ProfessionalDto> {
    await this.authz.authorize(ctx, 'view', { type: 'professional', id });
    const found = await this.org.findProfessional(ctx.user.organizationId, id);
    return found ?? this.authz.notFound(ctx, 'view', 'professional', id, NOT_FOUND);
  }

  @Post()
  async create(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<ProfessionalDto> {
    await this.authz.authorize(ctx, 'create', { type: 'professional' });
    const input = parseBody(professionalCreateSchema, body);
    return this.org.createProfessional(ctx.user.organizationId, input);
  }

  @Patch(':id')
  async update(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<ProfessionalDto> {
    await this.authz.authorize(ctx, 'edit', { type: 'professional', id });
    const input = parseBody(professionalUpdateSchema, body);
    if (!(await this.org.findProfessional(ctx.user.organizationId, id))) {
      return this.authz.notFound(ctx, 'edit', 'professional', id, NOT_FOUND);
    }
    return this.org.updateProfessional(ctx.user.organizationId, id, input);
  }
}
