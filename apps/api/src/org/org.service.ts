import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type ProfessionalDto,
  type SpecialtyDto,
  type UnitDto,
  type professionalCreateSchema,
  type professionalUpdateSchema,
  type specialtyCreateSchema,
  type specialtyUpdateSchema,
  type unitCreateSchema,
  type unitUpdateSchema,
} from '@crm/shared';
import type { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, Specialty, Unit } from '../generated/prisma/client.js';

const PROFESSIONAL_INCLUDE = {
  user: { select: { name: true } },
  specialties: { include: { specialty: { select: { name: true } } } },
} as const satisfies Prisma.ProfessionalInclude;

type ProfessionalRow = Prisma.ProfessionalGetPayload<{ include: typeof PROFESSIONAL_INCLUDE }>;

const unitDto = (u: Unit): UnitDto => ({
  id: u.id,
  name: u.name,
  timezone: u.timezone,
  active: u.active,
});

const specialtyDto = (s: Specialty): SpecialtyDto => ({ id: s.id, name: s.name, active: s.active });

const professionalDto = (p: ProfessionalRow): ProfessionalDto => ({
  id: p.id,
  userId: p.userId,
  name: p.user.name,
  crmNumber: p.crmNumber,
  crmState: p.crmState,
  active: p.active,
  specialties: p.specialties
    .map((s) => ({ id: s.specialtyId, name: s.specialty.name, rqe: s.rqe }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
});

const rule = (message: string) => new AppError(422, ErrorCode.BUSINESS_RULE_VIOLATION, message);

type SpecialtyInput = { specialtyId: string; rqe?: string | undefined }[];

/**
 * Unidades, especialidades e fichas profissionais. Toda consulta é restrita à organização
 * informada; a permissão é conferida antes, no controller.
 */
@Injectable()
export class OrgService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Unidades

  async listUnits(organizationId: string, onlyIds?: readonly string[]): Promise<UnitDto[]> {
    const units = await this.prisma.unit.findMany({
      where: { organizationId, ...(onlyIds ? { id: { in: [...onlyIds] } } : {}) },
      orderBy: { name: 'asc' },
    });
    return units.map(unitDto);
  }

  async findUnit(organizationId: string, id: string): Promise<UnitDto | null> {
    const unit = await this.prisma.unit.findFirst({ where: { id, organizationId } });
    return unit ? unitDto(unit) : null;
  }

  async createUnit(organizationId: string, input: z.infer<typeof unitCreateSchema>) {
    return unitDto(await this.prisma.unit.create({ data: { organizationId, ...input } }));
  }

  async updateUnit(id: string, input: z.infer<typeof unitUpdateSchema>) {
    return unitDto(await this.prisma.unit.update({ where: { id }, data: input }));
  }

  /** Médicos ativos com ficha profissional ativa vinculados à unidade. */
  async listUnitProfessionals(organizationId: string, unitId: string): Promise<ProfessionalDto[]> {
    const rows = await this.prisma.professional.findMany({
      where: {
        organizationId,
        active: true,
        user: { active: true, unitMemberships: { some: { unitId } } },
      },
      include: PROFESSIONAL_INCLUDE,
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map(professionalDto);
  }

  // Especialidades

  async listSpecialties(organizationId: string): Promise<SpecialtyDto[]> {
    const rows = await this.prisma.specialty.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
    return rows.map(specialtyDto);
  }

  async findSpecialty(organizationId: string, id: string): Promise<SpecialtyDto | null> {
    const row = await this.prisma.specialty.findFirst({ where: { id, organizationId } });
    return row ? specialtyDto(row) : null;
  }

  async createSpecialty(organizationId: string, input: z.infer<typeof specialtyCreateSchema>) {
    return specialtyDto(await this.prisma.specialty.create({ data: { organizationId, ...input } }));
  }

  async updateSpecialty(id: string, input: z.infer<typeof specialtyUpdateSchema>) {
    return specialtyDto(await this.prisma.specialty.update({ where: { id }, data: input }));
  }

  // Profissionais

  async listProfessionals(organizationId: string): Promise<ProfessionalDto[]> {
    const rows = await this.prisma.professional.findMany({
      where: { organizationId },
      include: PROFESSIONAL_INCLUDE,
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map(professionalDto);
  }

  async findProfessional(organizationId: string, id: string): Promise<ProfessionalDto | null> {
    const row = await this.prisma.professional.findFirst({
      where: { id, organizationId },
      include: PROFESSIONAL_INCLUDE,
    });
    return row ? professionalDto(row) : null;
  }

  async createProfessional(
    organizationId: string,
    input: z.infer<typeof professionalCreateSchema>,
  ): Promise<ProfessionalDto> {
    const user = await this.prisma.user.findFirst({ where: { id: input.userId, organizationId } });
    if (!user) throw rule('Usuário não encontrado nesta organização.');
    if (!user.roles.includes('doctor')) {
      throw rule('A ficha profissional é só para quem tem o papel de médico.');
    }
    await this.assertSpecialtiesUsable(organizationId, input.specialties);
    const row = await this.prisma.professional.create({
      data: {
        organizationId,
        userId: input.userId,
        crmNumber: input.crmNumber,
        crmState: input.crmState,
        specialties: { create: input.specialties.map(toLink) },
      },
      include: PROFESSIONAL_INCLUDE,
    });
    return professionalDto(row);
  }

  async updateProfessional(
    organizationId: string,
    id: string,
    input: z.infer<typeof professionalUpdateSchema>,
  ): Promise<ProfessionalDto> {
    const { specialties, ...fields } = input;
    if (specialties) await this.assertSpecialtiesUsable(organizationId, specialties, id);
    const row = await this.prisma.$transaction(async (tx) => {
      if (specialties) {
        await tx.professionalSpecialty.deleteMany({ where: { professionalId: id } });
        await tx.professionalSpecialty.createMany({
          data: specialties.map((s) => ({ professionalId: id, ...toLink(s) })),
        });
      }
      return tx.professional.update({ where: { id }, data: fields, include: PROFESSIONAL_INCLUDE });
    });
    return professionalDto(row);
  }

  /**
   * Especialidades precisam ser da organização e estar ativas. Na edição, uma especialidade
   * inativa que a ficha já tinha pode continuar (não se perde o histórico).
   */
  private async assertSpecialtiesUsable(
    organizationId: string,
    list: SpecialtyInput,
    professionalId?: string,
  ): Promise<void> {
    if (list.length === 0) return;
    const ids = list.map((s) => s.specialtyId);
    const found = await this.prisma.specialty.findMany({
      where: { id: { in: ids }, organizationId },
    });
    if (found.length !== ids.length) throw rule('Uma das especialidades não existe.');
    const inactive = found.filter((s) => !s.active);
    if (inactive.length === 0) return;
    const kept = professionalId
      ? await this.prisma.professionalSpecialty.findMany({
          where: { professionalId, specialtyId: { in: inactive.map((s) => s.id) } },
        })
      : [];
    const blocked = inactive.find((s) => !kept.some((k) => k.specialtyId === s.id));
    if (blocked) throw rule(`A especialidade "${blocked.name}" está inativa.`);
  }
}

const toLink = (s: { specialtyId: string; rqe?: string | undefined }) => ({
  specialtyId: s.specialtyId,
  rqe: s.rqe ?? null,
});
