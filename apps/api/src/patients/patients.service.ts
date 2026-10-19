import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type PatientCreateInput,
  type PatientDto,
  type PatientSummaryDto,
  type PatientUpdateInput,
  type PatientVersionDto,
  ageOn,
  channelProblems,
  displayName,
  formatCpf,
  maskCpf,
  normalizeSearch,
  onlyDigits,
  similarNames,
} from '@crm/shared';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { APP_CONFIG } from '../config.tokens.js';
import type { AppConfig } from '../config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PiiProtector } from './pii.js';

const INCLUDE = {
  phones: { orderBy: { position: 'asc' } },
  contacts: { orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
} as const satisfies Prisma.PatientInclude;

type PatientRow = Prisma.PatientGetPayload<{ include: typeof INCLUDE }>;

/** Estado completo do cadastro, sem metadados, usado para comparar versões. */
type PatientState = Omit<PatientDto, 'id' | 'displayName' | 'version' | 'createdAt' | 'updatedAt'>;

const TRACKED_FIELDS = [
  'fullName',
  'socialName',
  'cpf',
  'birthDate',
  'email',
  'phones',
  'address',
  'guardians',
  'emergencyContacts',
  'communication',
  'active',
] as const satisfies readonly (keyof PatientState)[];

const ADULT_AGE = 18;
const CLINIC_TIMEZONE = 'America/Sao_Paulo';

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const fromDate = (d: Date) => d.toISOString().slice(0, 10);

const versionConflict = () =>
  new AppError(
    409,
    ErrorCode.VERSION_CONFLICT,
    'Outra pessoa alterou este cadastro enquanto você editava. Recarregue para ver a versão atual.',
  );
const cpfTaken = () =>
  new AppError(409, ErrorCode.CPF_ALREADY_REGISTERED, 'Já existe um paciente com este CPF.');

/**
 * Cadastro de pacientes. Toda consulta é restrita à organização informada; a permissão e a
 * auditoria de acesso são feitas antes, no controller. Ver docs/api/pacientes.md.
 */
@Injectable()
export class PatientsService {
  private readonly pii: PiiProtector;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.pii = new PiiProtector(config.PII_ENCRYPTION_KEY);
  }

  // Leitura

  async find(organizationId: string, id: string): Promise<PatientDto | null> {
    const row = await this.prisma.patient.findFirst({
      where: { id, organizationId },
      include: INCLUDE,
    });
    return row ? this.toDto(row) : null;
  }

  async search(
    organizationId: string,
    params: { q: string; includeInactive: boolean; limit: number },
  ): Promise<PatientSummaryDto[]> {
    const digits = onlyDigits(params.q);
    const isNumeric = /^[\d\s().\-/]+$/.test(params.q);
    const or: Prisma.PatientWhereInput[] = [];

    if (isNumeric) {
      if (digits.length === 11) or.push({ cpfHash: this.pii.lookupHash(digits) });
      if (digits.length >= 4) or.push({ phones: { some: { number: { contains: digits } } } });
      if (or.length === 0) return [];
    } else {
      const words = normalizeSearch(params.q).split(' ').filter(Boolean);
      if (words.length === 0) return [];
      or.push({ AND: words.map((w) => ({ nameSearch: { contains: w } })) });
    }

    const rows = await this.prisma.patient.findMany({
      where: { organizationId, ...(params.includeInactive ? {} : { active: true }), OR: or },
      include: INCLUDE,
      orderBy: [{ nameSearch: 'asc' }, { id: 'asc' }],
      take: params.limit,
    });
    return rows.map((r) => this.toSummary(r));
  }

  /** Cadastros parecidos: mesma data de nascimento com nome parecido, ou mesmo telefone. */
  async findSimilar(
    organizationId: string,
    probe: { fullName: string; birthDate: string; phones: string[] },
    excludeId?: string,
  ): Promise<PatientSummaryDto[]> {
    const rows = await this.prisma.patient.findMany({
      where: {
        organizationId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [
          { birthDate: toDate(probe.birthDate) },
          ...(probe.phones.length > 0
            ? [{ phones: { some: { number: { in: probe.phones } } } }]
            : []),
        ],
      },
      include: INCLUDE,
      take: 200,
    });
    const name = normalizeSearch(probe.fullName);
    return rows
      .filter(
        (r) =>
          r.phones.some((p) => probe.phones.includes(p.number)) ||
          (fromDate(r.birthDate) === probe.birthDate &&
            [r.fullName, r.socialName].some((n) => n && similarNames(name, normalizeSearch(n)))),
      )
      .slice(0, 10)
      .map((r) => this.toSummary(r));
  }

  /** O CPF já existe na organização? Considera também cadastros inativos. */
  async cpfOwner(organizationId: string, cpf: string): Promise<string | null> {
    const row = await this.prisma.patient.findFirst({
      where: { organizationId, cpfHash: this.pii.lookupHash(cpf) },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async history(patientId: string): Promise<PatientVersionDto[]> {
    const rows = await this.prisma.patientVersion.findMany({
      where: { patientId },
      orderBy: { version: 'desc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.changedByUserId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      version: r.version,
      changedAt: r.changedAt.toISOString(),
      changedBy: { id: r.changedByUserId, name: names.get(r.changedByUserId) ?? '' },
      changedFields: r.changedFields,
      snapshot: r.snapshot as unknown as PatientVersionDto['snapshot'],
    }));
  }

  // Escrita

  async create(
    organizationId: string,
    actorId: string,
    input: PatientCreateInput,
  ): Promise<PatientDto> {
    const state: PatientState = {
      fullName: input.fullName,
      socialName: input.socialName ?? null,
      cpf: input.cpf ?? null,
      birthDate: input.birthDate,
      email: input.email ?? null,
      phones: input.phones,
      address: input.address
        ? { ...input.address, complement: input.address.complement ?? null }
        : null,
      guardians: input.guardians.map((g) => ({
        ...g,
        phone: g.phone ?? null,
        email: g.email ?? null,
      })),
      emergencyContacts: input.emergencyContacts,
      communication: input.communication,
      active: true,
    };
    this.assertBusinessRules(state);

    if (state.cpf && (await this.cpfOwner(organizationId, state.cpf))) throw cpfTaken();
    if (!input.allowPossibleDuplicate) {
      const similar = await this.findSimilar(organizationId, {
        fullName: state.fullName,
        birthDate: state.birthDate,
        phones: state.phones.map((p) => p.number),
      });
      if (similar.length > 0) {
        throw new AppError(
          409,
          ErrorCode.POSSIBLE_DUPLICATE,
          'Encontramos cadastros parecidos. Confira antes de criar um novo.',
          similar.map((s) => ({ field: 'candidateId', issue: s.id })),
        );
      }
    }

    const id = await this.withCpfConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.patient.create({
          data: { organizationId, ...this.columns(state), ...this.children(state) },
        });
        await this.recordVersion(tx, created.id, 1, actorId, ['created'], state);
        return created.id;
      }),
    );
    return this.mustFind(organizationId, id);
  }

  async update(
    organizationId: string,
    actorId: string,
    current: PatientDto,
    input: PatientUpdateInput,
  ): Promise<PatientDto> {
    if (input.version !== current.version) throw versionConflict();

    const { version, ...changes } = input;
    const next: PatientState = { ...this.stateOf(current) };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) continue;
      (next as Record<string, unknown>)[key] = value;
    }
    next.address = next.address
      ? { ...next.address, complement: next.address.complement ?? null }
      : null;
    next.guardians = next.guardians.map((g) => ({
      ...g,
      phone: g.phone ?? null,
      email: g.email ?? null,
    }));
    next.socialName = next.socialName ?? null;
    next.email = next.email ?? null;
    next.cpf = next.cpf ?? null;

    const changed = TRACKED_FIELDS.filter(
      (f) => JSON.stringify(next[f]) !== JSON.stringify(this.stateOf(current)[f]),
    );
    if (changed.length === 0) return current;

    this.assertBusinessRules(next);
    if (changed.includes('cpf') && next.cpf) {
      const owner = await this.cpfOwner(organizationId, next.cpf);
      if (owner && owner !== current.id) throw cpfTaken();
    }

    await this.withCpfConflict(() =>
      this.prisma.$transaction(async (tx) => {
        // A versão no WHERE garante que duas edições simultâneas não se sobrescrevam.
        const updated = await tx.patient.updateMany({
          where: { id: current.id, organizationId, version },
          data: { ...this.columns(next), version: { increment: 1 } },
        });
        if (updated.count === 0) throw versionConflict();
        if (changed.includes('phones')) {
          await tx.patientPhone.deleteMany({ where: { patientId: current.id } });
          await tx.patientPhone.createMany({
            data: next.phones.map((p, position) => ({ patientId: current.id, ...p, position })),
          });
        }
        if (changed.includes('guardians') || changed.includes('emergencyContacts')) {
          await tx.patientContact.deleteMany({ where: { patientId: current.id } });
          await tx.patientContact.createMany({
            data: this.contactRows(next).map((c) => ({ patientId: current.id, ...c })),
          });
        }
        await this.recordVersion(tx, current.id, version + 1, actorId, changed, next);
      }),
    );
    return this.mustFind(organizationId, current.id);
  }

  // Apoio

  /** Data de hoje no fuso da clínica (AAAA-MM-DD). */
  today(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(this.clock.now());
  }

  private assertBusinessRules(state: PatientState): void {
    const today = this.today();
    if (state.birthDate > today) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'Dados inválidos.', [
        { field: 'birthDate', issue: 'A data de nascimento não pode ser futura.' },
      ]);
    }
    const problems = channelProblems(state);
    if (problems.length > 0) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'Dados inválidos.', problems);
    }
    if (ageOn(state.birthDate, today) < ADULT_AGE && state.guardians.length === 0) {
      throw new AppError(
        422,
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'Paciente menor de 18 anos precisa de ao menos um responsável legal.',
      );
    }
  }

  private async withCpfConflict<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      // Corrida entre dois cadastros com o mesmo CPF: o índice único do banco decide.
      const meta = (error as { code?: string; meta?: unknown }).meta;
      if (
        (error as { code?: string }).code === 'P2002' &&
        JSON.stringify(meta ?? '').includes('cpf')
      ) {
        throw cpfTaken();
      }
      throw error;
    }
  }

  private async mustFind(organizationId: string, id: string): Promise<PatientDto> {
    const found = await this.find(organizationId, id);
    if (!found) throw new Error(`Paciente ${id} sumiu logo após ser gravado.`);
    return found;
  }

  private columns(s: PatientState) {
    return {
      fullName: s.fullName,
      socialName: s.socialName,
      nameSearch: normalizeSearch(`${s.fullName} ${s.socialName ?? ''}`),
      cpfEnc: s.cpf ? this.pii.encrypt(s.cpf) : null,
      cpfHash: s.cpf ? this.pii.lookupHash(s.cpf) : null,
      birthDate: toDate(s.birthDate),
      email: s.email,
      addressZip: s.address?.zip ?? null,
      addressStreet: s.address?.street ?? null,
      addressNumber: s.address?.number ?? null,
      addressComplement: s.address?.complement ?? null,
      addressDistrict: s.address?.district ?? null,
      addressCity: s.address?.city ?? null,
      addressState: s.address?.state ?? null,
      commChannels: s.communication.channels,
      appointmentReminders: s.communication.appointmentReminders,
      marketingOptIn: s.communication.marketing,
      active: s.active,
    };
  }

  private children(s: PatientState) {
    return {
      phones: { create: s.phones.map((p, position) => ({ ...p, position })) },
      contacts: { create: this.contactRows(s) },
    };
  }

  private contactRows(s: PatientState) {
    return [
      ...s.guardians.map((g, position) => ({ kind: 'guardian' as const, ...g, position })),
      ...s.emergencyContacts.map((c, position) => ({
        kind: 'emergency' as const,
        ...c,
        email: null,
        position,
      })),
    ];
  }

  private async recordVersion(
    tx: Prisma.TransactionClient,
    patientId: string,
    version: number,
    actorId: string,
    changedFields: string[],
    state: PatientState,
  ): Promise<void> {
    const { cpf, ...rest } = state;
    const snapshot = { ...rest, displayName: displayName(state), hasCpf: cpf !== null };
    await tx.patientVersion.create({
      data: {
        patientId,
        version,
        changedAt: this.clock.now(),
        changedByUserId: actorId,
        changedFields,
        snapshot: snapshot as unknown as Prisma.InputJsonObject,
      },
    });
  }

  private stateOf(p: PatientDto): PatientState {
    return {
      fullName: p.fullName,
      socialName: p.socialName,
      cpf: p.cpf ? onlyDigits(p.cpf) : null,
      birthDate: p.birthDate,
      email: p.email,
      phones: p.phones,
      address: p.address,
      guardians: p.guardians,
      emergencyContacts: p.emergencyContacts,
      communication: p.communication,
      active: p.active,
    };
  }

  private toDto(r: PatientRow): PatientDto {
    const cpf = r.cpfEnc ? this.pii.decrypt(r.cpfEnc) : null;
    return {
      id: r.id,
      displayName: displayName(r),
      fullName: r.fullName,
      socialName: r.socialName,
      cpf: cpf ? formatCpf(cpf) : null,
      birthDate: fromDate(r.birthDate),
      email: r.email,
      phones: r.phones.map((p) => ({ number: p.number, whatsapp: p.whatsapp })),
      address:
        r.addressZip &&
        r.addressStreet &&
        r.addressNumber &&
        r.addressDistrict &&
        r.addressCity &&
        r.addressState
          ? {
              zip: r.addressZip,
              street: r.addressStreet,
              number: r.addressNumber,
              complement: r.addressComplement,
              district: r.addressDistrict,
              city: r.addressCity,
              state: r.addressState,
            }
          : null,
      guardians: r.contacts
        .filter((c) => c.kind === 'guardian')
        .map((c) => ({
          name: c.name,
          relationship: c.relationship,
          phone: c.phone,
          email: c.email,
        })),
      emergencyContacts: r.contacts
        .filter((c) => c.kind === 'emergency')
        .map((c) => ({ name: c.name, relationship: c.relationship, phone: c.phone ?? '' })),
      communication: {
        channels: r.commChannels,
        appointmentReminders: r.appointmentReminders,
        marketing: r.marketingOptIn,
      },
      active: r.active,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toSummary(r: PatientRow): PatientSummaryDto {
    return {
      id: r.id,
      displayName: displayName(r),
      fullName: r.fullName,
      socialName: r.socialName,
      birthDate: fromDate(r.birthDate),
      cpfMasked: r.cpfEnc ? maskCpf(this.pii.decrypt(r.cpfEnc)) : null,
      primaryPhone: r.phones[0]?.number ?? null,
      active: r.active,
    };
  }
}
