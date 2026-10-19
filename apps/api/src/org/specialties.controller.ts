import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { type SpecialtyDto, specialtyCreateSchema, specialtyUpdateSchema } from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { OrgService } from './org.service.js';

@Controller('specialties')
export class SpecialtiesController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(OrgService) private readonly org: OrgService,
  ) {}

  @Get()
  async list(@Auth() ctx: AuthContext): Promise<SpecialtyDto[]> {
    await this.authz.authorize(ctx, 'view', { type: 'specialty' });
    return this.org.listSpecialties(ctx.user.organizationId);
  }

  @Post()
  async create(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<SpecialtyDto> {
    await this.authz.authorize(ctx, 'create', { type: 'specialty' });
    return this.org.createSpecialty(
      ctx.user.organizationId,
      parseBody(specialtyCreateSchema, body),
    );
  }

  @Patch(':id')
  async update(
    @Auth() ctx: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<SpecialtyDto> {
    await this.authz.authorize(ctx, 'edit', { type: 'specialty', id });
    const input = parseBody(specialtyUpdateSchema, body);
    if (!(await this.org.findSpecialty(ctx.user.organizationId, id))) {
      return this.authz.notFound(ctx, 'edit', 'specialty', id, 'Especialidade não encontrada.');
    }
    return this.org.updateSpecialty(id, input);
  }
}
