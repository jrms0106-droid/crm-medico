import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, type RoleName, type UserAccountDto } from '@crm/shared';
import type { z } from 'zod';
import type { userCreateSchema, userUpdateSchema } from '@crm/shared';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { hashPassword, temporaryPassword } from './password.js';
import { SessionService } from './session.service.js';

const ACCOUNT_INCLUDE = {
  unitMemberships: { select: { unitId: true }, orderBy: { createdAt: 'asc' } },
  professional: { select: { id: true, active: true } },
} as const satisfies Prisma.UserInclude;

type AccountRow = Prisma.UserGetPayload<{ include: typeof ACCOUNT_INCLUDE }>;

function toDto(user: AccountRow): UserAccountDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    roles: user.roles,
    unitIds: user.unitMemberships.map((m) => m.unitId),
    active: user.active,
    mfaEnabled: user.mfaEnabled,
    mustChangePassword: user.mustChangePassword,
    professionalId: user.professional?.id ?? null,
  };
}

const rule = (message: string) => new AppError(422, ErrorCode.BUSINESS_RULE_VIOLATION, message);

/** Cadastro de contas feito pelo administrador. A permissão é conferida antes, no controller. */
@Injectable()
export class UserAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async list(organizationId: string): Promise<UserAccountDto[]> {
    const users = await this.prisma.user.findMany({
      where: { organizationId },
      include: ACCOUNT_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return users.map(toDto);
  }

  /** Só encontra contas da organização indicada. */
  async find(organizationId: string, id: string): Promise<UserAccountDto | null> {
    const user = await this.prisma.user.findFirst({
      where: { id, organizationId },
      include: ACCOUNT_INCLUDE,
    });
    return user ? toDto(user) : null;
  }

  async create(
    organizationId: string,
    input: z.infer<typeof userCreateSchema>,
  ): Promise<{ user: UserAccountDto; temporaryPassword: string }> {
    await this.assertUnitsBelong(organizationId, input.unitIds);
    const password = temporaryPassword(randomBytes);
    const user = await this.prisma.user.create({
      data: {
        organizationId,
        name: input.name,
        email: input.email,
        roles: input.roles,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        unitMemberships: { create: input.unitIds.map((unitId) => ({ unitId })) },
      },
      include: ACCOUNT_INCLUDE,
    });
    return { user: toDto(user), temporaryPassword: password };
  }

  async update(
    actorId: string,
    target: UserAccountDto,
    organizationId: string,
    input: z.infer<typeof userUpdateSchema>,
  ): Promise<UserAccountDto> {
    if (input.roles) this.assertRoleChangeAllowed(actorId, target, input.roles);
    if (input.unitIds) await this.assertUnitsBelong(organizationId, input.unitIds);

    const user = await this.prisma.$transaction(async (tx) => {
      if (input.unitIds) {
        await tx.unitMembership.deleteMany({ where: { userId: target.id } });
        await tx.unitMembership.createMany({
          data: input.unitIds.map((unitId) => ({ userId: target.id, unitId })),
        });
      }
      return tx.user.update({
        where: { id: target.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.roles !== undefined ? { roles: input.roles } : {}),
        },
        include: ACCOUNT_INCLUDE,
      });
    });

    if (this.changesAccess(target, input)) {
      // Quem teve papéis ou unidades alterados entra de novo, já com as permissões novas.
      await this.sessions.revokeAllForUser(target.id);
    }
    return toDto(user);
  }

  async reactivate(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { active: true, failedLoginCount: 0, lockedUntil: null },
    });
  }

  changesAccess(target: UserAccountDto, input: z.infer<typeof userUpdateSchema>): boolean {
    const differs = (a: readonly string[], b: readonly string[]) =>
      a.length !== b.length || a.some((x) => !b.includes(x));
    return (
      (input.roles !== undefined && differs(input.roles, target.roles)) ||
      (input.unitIds !== undefined && differs(input.unitIds, target.unitIds))
    );
  }

  private assertRoleChangeAllowed(actorId: string, target: UserAccountDto, roles: RoleName[]) {
    if (actorId === target.id && !roles.includes('admin')) {
      throw rule('Você não pode tirar o seu próprio papel de administrador.');
    }
    if (target.professionalId && !roles.includes('doctor')) {
      throw rule(
        'Esta pessoa tem ficha profissional. Desative a ficha antes de tirar o papel de médico.',
      );
    }
  }

  private async assertUnitsBelong(organizationId: string, unitIds: string[]): Promise<void> {
    const count = await this.prisma.unit.count({
      where: { id: { in: unitIds }, organizationId, active: true },
    });
    if (count !== unitIds.length)
      throw rule('Uma das unidades escolhidas não existe ou está inativa.');
  }
}
