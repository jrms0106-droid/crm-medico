import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  type ProfessionalDto,
  type UnitDto,
  unitCreateSchema,
  unitUpdateSchema,
} from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { OrgService } from './org.service.js';

const uuid = new ParseUUIDPipe();
const UNIT_NOT_FOUND = 'Unidade não encontrada.';

@Controller('units')
export class UnitsController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(OrgService) private readonly org: OrgService,
  ) {}

  /** O administrador vê todas as unidades da organização; os demais, só as suas. */
  @Get()
  async list(@Auth() ctx: AuthContext): Promise<UnitDto[]> {
    await this.authz.authorize(ctx, 'view', { type: 'unit' });
    const all = ctx.user.roles.includes('admin');
    return this.org.listUnits(ctx.user.organizationId, all ? undefined : ctx.unitIds);
  }

  @Post()
  async create(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<UnitDto> {
    await this.authz.authorize(ctx, 'create', { type: 'unit' });
    return this.org.createUnit(ctx.user.organizationId, parseBody(unitCreateSchema, body));
  }

  @Patch(':id')
  async update(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<UnitDto> {
    await this.authz.authorize(ctx, 'edit', { type: 'unit', id, unitId: id });
    const input = parseBody(unitUpdateSchema, body);
    await this.load(ctx, 'edit', id);
    return this.org.updateUnit(id, input);
  }

  /** Equipe médica da unidade: só para quem pertence à unidade. */
  @Get(':id/professionals')
  async professionals(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
  ): Promise<ProfessionalDto[]> {
    await this.load(ctx, 'view', id);
    await this.authz.authorize(ctx, 'view', { type: 'unit_professionals', id, unitId: id });
    return this.org.listUnitProfessionals(ctx.user.organizationId, id);
  }

  private async load(ctx: AuthContext, action: 'view' | 'edit', id: string) {
    const unit = await this.org.findUnit(ctx.user.organizationId, id);
    return unit ?? this.authz.notFound(ctx, action, 'unit', id, UNIT_NOT_FOUND);
  }
}
