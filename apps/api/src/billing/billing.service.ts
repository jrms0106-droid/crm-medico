import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type ChargeDto,
  type ChargeStatus,
  ErrorCode,
  type FinancialReportDto,
  PAYMENT_METHODS,
  type PaymentDto,
  type PaymentMethod,
  type PriceItemDto,
  type chargeCreateSchema,
  type chargeListQuerySchema,
  type paymentCreateSchema,
  type priceItemCreateSchema,
  type priceItemUpdateSchema,
  type reportQuerySchema,
} from '@crm/shared';
import type { z } from 'zod';
import { AppError } from '../common/app-error.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../database/prisma.service.js';
import { type Charge, type Payment, Prisma } from '../generated/prisma/client.js';
import type { AuthContext } from '../identity/session.service.js';
import { canonicalJson } from '../records/records.service.js';
import { fromLocal } from '../scheduling/time.js';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const DAY_MS = 24 * 3_600_000;
/** Pagamento com data anterior: no máximo 30 dias para trás. */
const MAX_BACKDATE_MS = 30 * DAY_MS;

type ChargeWithPayments = Charge & { payments: Payment[] };

function unique(error: unknown, constraint: string): boolean {
  const text = (() => {
    try {
      return JSON.stringify(error, Object.getOwnPropertyNames(error ?? {}));
    } catch {
      return String(error);
    }
  })();
  return (error as { code?: string })?.code === 'P2002' || text.includes(constraint);
}

const conflict = (code: ErrorCode, message: string) => new AppError(409, code, message);
const rule = (message: string) => new AppError(422, ErrorCode.BUSINESS_RULE_VIOLATION, message);

/** Valores derivados: líquido, pago, saldo e situação. */
export function chargeTotals(charge: ChargeWithPayments) {
  const netCents = charge.amountCents - charge.discountCents;
  const paidCents = charge.payments
    .filter((p) => !p.reversedAt)
    .reduce((sum, p) => sum + p.amountCents, 0);
  const balanceCents = netCents - paidCents;
  const status: ChargeStatus = charge.cancelledAt
    ? 'cancelled'
    : balanceCents <= 0
      ? 'paid'
      : paidCents > 0
        ? 'partially_paid'
        : 'open';
  return { netCents, paidCents, balanceCents, status };
}

/**
 * Financeiro particular (docs/api/financeiro.md). Este serviço só grava e lê; quem decide o
 * acesso é o controlador, pela política. A imutabilidade de valores e pagamentos também está no
 * banco (gatilhos `billing.protect_charge` e `billing.protect_payment`).
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  // ---- Tabela de preços ----

  async listPrices(organizationId: string, includeInactive: boolean): Promise<PriceItemDto[]> {
    const rows = await this.prisma.priceItem.findMany({
      where: { organizationId, ...(includeInactive ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      amountCents: r.amountCents,
      active: r.active,
    }));
  }

  async findPrice(organizationId: string, id: string) {
    return this.prisma.priceItem.findFirst({ where: { id, organizationId } });
  }

  async createPrice(
    organizationId: string,
    input: z.infer<typeof priceItemCreateSchema>,
  ): Promise<PriceItemDto> {
    try {
      const r = await this.prisma.priceItem.create({ data: { organizationId, ...input } });
      return { id: r.id, name: r.name, amountCents: r.amountCents, active: r.active };
    } catch (error) {
      if (unique(error, 'price_items_organization_id_name_key')) {
        throw conflict(ErrorCode.CONFLICT, 'Já existe um item com esse nome.');
      }
      throw error;
    }
  }

  async updatePrice(
    id: string,
    input: z.infer<typeof priceItemUpdateSchema>,
  ): Promise<PriceItemDto> {
    try {
      const r = await this.prisma.priceItem.update({ where: { id }, data: input });
      return { id: r.id, name: r.name, amountCents: r.amountCents, active: r.active };
    } catch (error) {
      if (unique(error, 'price_items_organization_id_name_key')) {
        throw conflict(ErrorCode.CONFLICT, 'Já existe um item com esse nome.');
      }
      throw error;
    }
  }

  // ---- Cobranças ----

  async unitExists(organizationId: string, unitId: string): Promise<boolean> {
    return (await this.prisma.unit.count({ where: { id: unitId, organizationId } })) > 0;
  }

  async findCharge(organizationId: string, id: string): Promise<ChargeWithPayments | null> {
    return this.prisma.charge.findFirst({
      where: { id, organizationId },
      include: { payments: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async createCharge(
    ctx: AuthContext,
    input: z.infer<typeof chargeCreateSchema>,
  ): Promise<ChargeDto> {
    const org = ctx.user.organizationId;
    const patient = await this.prisma.patient.count({
      where: { id: input.patientId, organizationId: org },
    });
    if (!patient) throw new AppError(404, ErrorCode.NOT_FOUND, 'Paciente não encontrado.');
    if (input.appointmentId) {
      const appointment = await this.prisma.appointment.findFirst({
        where: { id: input.appointmentId, organizationId: org },
        select: { unitId: true, patientId: true },
      });
      if (!appointment) throw new AppError(404, ErrorCode.NOT_FOUND, 'Consulta não encontrada.');
      if (appointment.unitId !== input.unitId || appointment.patientId !== input.patientId) {
        throw rule('A consulta é de outra unidade ou de outro paciente.');
      }
    }
    let description = input.description;
    let amountCents = input.amountCents;
    if (input.priceItemId) {
      const item = await this.findPrice(org, input.priceItemId);
      if (!item || !item.active) {
        throw new AppError(404, ErrorCode.NOT_FOUND, 'Item da tabela não encontrado ou inativo.');
      }
      description ??= item.name;
      amountCents ??= item.amountCents;
    }
    if (!description || !amountCents) throw rule('Informe descrição e valor.');
    if (input.discountCents > amountCents) throw rule('O desconto não pode passar do valor.');
    try {
      const created = await this.prisma.charge.create({
        data: {
          organizationId: org,
          unitId: input.unitId,
          patientId: input.patientId,
          appointmentId: input.appointmentId ?? null,
          priceItemId: input.priceItemId ?? null,
          description,
          amountCents,
          discountCents: input.discountCents,
          createdByUserId: ctx.user.id,
          createdAt: this.clock.now(),
        },
        select: { id: true },
      });
      return this.chargeDto(await this.reload(created.id));
    } catch (error) {
      if (unique(error, 'charges_one_active_per_appointment')) {
        throw conflict(
          ErrorCode.CONFLICT,
          'Esta consulta já tem uma cobrança. Cancele-a antes de criar outra.',
        );
      }
      throw error;
    }
  }

  async listCharges(
    organizationId: string,
    q: z.infer<typeof chargeListQuerySchema>,
  ): Promise<ChargeDto[]> {
    const tz = await this.timezone(q.unitId);
    const rows = await this.prisma.charge.findMany({
      where: {
        organizationId,
        unitId: q.unitId,
        ...(q.patientId ? { patientId: q.patientId } : {}),
        createdAt: {
          ...(q.from ? { gte: fromLocal(q.from, 0, tz) } : {}),
          ...(q.to ? { lt: new Date(fromLocal(q.to, 0, tz).getTime() + DAY_MS) } : {}),
        },
      },
      include: { payments: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const dtos = await this.chargeDtos(rows);
    return q.status ? dtos.filter((c) => c.status === q.status) : dtos;
  }

  async cancelCharge(ctx: AuthContext, charge: ChargeWithPayments, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, charge.id);
      const current = await tx.charge.findUniqueOrThrow({
        where: { id: charge.id },
        include: { payments: true },
      });
      if (current.cancelledAt) {
        throw conflict(ErrorCode.INVALID_STATE_TRANSITION, 'A cobrança já está cancelada.');
      }
      if (chargeTotals(current).paidCents > 0) {
        throw conflict(
          ErrorCode.INVALID_STATE_TRANSITION,
          'A cobrança tem pagamento confirmado. O administrador precisa estornar antes de cancelar.',
        );
      }
      await tx.charge.update({
        where: { id: charge.id },
        data: { cancelledAt: this.clock.now(), cancelledById: ctx.user.id, cancelReason: reason },
        select: { id: true },
      });
    });
    return this.chargeDto(await this.reload(charge.id));
  }

  /** Trava a cobrança até o fim da transação, para dois registros simultâneos não passarem do saldo. */
  private async lock(tx: Prisma.TransactionClient, chargeId: string) {
    await tx.$queryRaw`SELECT id FROM billing.charges WHERE id = ${chargeId}::uuid FOR UPDATE`;
  }

  // ---- Pagamentos ----

  async pay(
    ctx: AuthContext,
    charge: ChargeWithPayments,
    key: string,
    input: z.infer<typeof paymentCreateSchema>,
  ): Promise<ChargeDto> {
    const org = ctx.user.organizationId;
    const requestHash = createHash('sha256')
      .update(canonicalJson({ chargeId: charge.id, ...input }), 'utf8')
      .digest('hex');
    const replay = async () => {
      const existing = await this.prisma.payment.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: org, idempotencyKey: key } },
      });
      if (!existing) return null;
      if (existing.requestHash !== requestHash) {
        throw conflict(
          ErrorCode.IDEMPOTENCY_CONFLICT,
          'Esta chave já foi usada para outro pagamento. Recarregue a tela e tente de novo.',
        );
      }
      return this.chargeDto(await this.reload(existing.chargeId));
    };
    const previous = await replay();
    if (previous) return previous;

    const now = this.clock.now();
    const paidAt = input.paidAt ? new Date(input.paidAt) : now;
    if (paidAt.getTime() > now.getTime()) throw rule('A data do pagamento não pode ser no futuro.');
    if (now.getTime() - paidAt.getTime() > MAX_BACKDATE_MS) {
      throw rule('A data do pagamento pode ser no máximo 30 dias atrás.');
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lock(tx, charge.id);
        const current = await tx.charge.findUniqueOrThrow({
          where: { id: charge.id },
          include: { payments: true },
        });
        if (current.cancelledAt) {
          throw conflict(ErrorCode.INVALID_STATE_TRANSITION, 'A cobrança está cancelada.');
        }
        const { balanceCents } = chargeTotals(current);
        if (input.amountCents > balanceCents) {
          throw new AppError(
            422,
            ErrorCode.AMOUNT_EXCEEDS_BALANCE,
            `O valor passa do saldo da cobrança (saldo: ${balanceCents} centavos).`,
          );
        }
        await tx.payment.create({
          data: {
            organizationId: org,
            chargeId: charge.id,
            method: input.method,
            amountCents: input.amountCents,
            paidAt,
            receivedByUserId: ctx.user.id,
            idempotencyKey: key,
            requestHash,
            createdAt: now,
          },
          select: { id: true },
        });
      });
    } catch (error) {
      // Dois pedidos com a mesma chave ao mesmo tempo: o segundo devolve o resultado do primeiro.
      if (unique(error, 'payments_organization_id_idempotency_key_key')) {
        const raced = await replay();
        if (raced) return raced;
      }
      throw error;
    }
    return this.chargeDto(await this.reload(charge.id));
  }

  async findPayment(organizationId: string, id: string) {
    return this.prisma.payment.findFirst({
      where: { id, organizationId },
      include: { charge: { select: { unitId: true, patientId: true } } },
    });
  }

  async reverse(ctx: AuthContext, payment: Payment, reason: string): Promise<ChargeDto> {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, payment.chargeId);
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, reversedAt: null },
        data: { reversedAt: this.clock.now(), reversedById: ctx.user.id, reverseReason: reason },
      });
      if (count !== 1) {
        throw conflict(ErrorCode.INVALID_STATE_TRANSITION, 'Este pagamento já foi estornado.');
      }
    });
    return this.chargeDto(await this.reload(payment.chargeId));
  }

  // ---- Relatório ----

  async report(
    organizationId: string,
    unitIds: string[] | undefined,
    q: z.infer<typeof reportQuerySchema>,
  ): Promise<FinancialReportDto> {
    if (q.to < q.from) throw rule('A data final vem antes da inicial.');
    const tz = await this.timezone(q.unitId);
    const start = fromLocal(q.from, 0, tz);
    const end = new Date(fromLocal(q.to, 0, tz).getTime() + DAY_MS);
    if (end.getTime() - start.getTime() > 367 * DAY_MS) {
      throw rule('O período pode ter no máximo 366 dias.');
    }
    const units = q.unitId ? [q.unitId] : unitIds;
    const unitFilter = units ? { unitId: { in: units } } : {};

    const charged = await this.prisma.charge.findMany({
      where: {
        organizationId,
        ...unitFilter,
        cancelledAt: null,
        createdAt: { gte: start, lt: end },
      },
      select: { amountCents: true, discountCents: true },
    });
    const received = await this.prisma.payment.findMany({
      where: {
        organizationId,
        charge: unitFilter,
        reversedAt: null,
        paidAt: { gte: start, lt: end },
      },
      select: { method: true, amountCents: true },
    });
    const reversed = await this.prisma.payment.findMany({
      where: { organizationId, charge: unitFilter, reversedAt: { gte: start, lt: end } },
      select: { amountCents: true },
    });
    // Saldo em aberto calculado no banco (não carrega o histórico inteiro na memória). Mesma
    // regra de `chargeTotals`: líquido menos os pagamentos não estornados.
    const unitSql = units
      ? units.length > 0
        ? Prisma.sql`AND c.unit_id IN (${Prisma.join(units.map((u) => Prisma.sql`${u}::uuid`))})`
        : Prisma.sql`AND false`
      : Prisma.empty;
    const [open] = await this.prisma.$queryRaw<{ cents: bigint; n: number }[]>`
      SELECT COALESCE(SUM(x.balance), 0)::bigint AS cents, COUNT(*)::int AS n
      FROM (
        SELECT c.amount_cents - c.discount_cents - COALESCE(
          (SELECT SUM(p.amount_cents) FROM billing.payments p
           WHERE p.charge_id = c.id AND p.reversed_at IS NULL), 0) AS balance
        FROM billing.charges c
        WHERE c.organization_id = ${organizationId}::uuid AND c.cancelled_at IS NULL
          AND c.created_at < ${end} ${unitSql}
      ) x
      WHERE x.balance > 0`;

    const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<
      PaymentMethod,
      number
    >;
    for (const p of received) byMethod[p.method] += p.amountCents;
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const gross = sum(charged.map((c) => c.amountCents));
    const discount = sum(charged.map((c) => c.discountCents));
    return {
      from: q.from,
      to: q.to,
      unitId: q.unitId ?? null,
      charged: {
        count: charged.length,
        grossCents: gross,
        discountCents: discount,
        netCents: gross - discount,
      },
      received: { totalCents: sum(received.map((p) => p.amountCents)), byMethod },
      reversedCents: sum(reversed.map((p) => p.amountCents)),
      openCents: Number(open?.cents ?? 0),
      openCount: open?.n ?? 0,
    };
  }

  // ---- Apoio ----

  private async timezone(unitId: string | undefined): Promise<string> {
    if (!unitId) return DEFAULT_TIMEZONE;
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { timezone: true },
    });
    return unit?.timezone ?? DEFAULT_TIMEZONE;
  }

  private async reload(id: string): Promise<ChargeWithPayments> {
    return this.prisma.charge.findUniqueOrThrow({
      where: { id },
      include: { payments: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async chargeDto(charge: ChargeWithPayments): Promise<ChargeDto> {
    const [dto] = await this.chargeDtos([charge]);
    return dto as ChargeDto;
  }

  async chargeDtos(rows: ChargeWithPayments[]): Promise<ChargeDto[]> {
    const userIds = rows.flatMap((c) => [
      c.createdByUserId,
      ...c.payments.flatMap((p) => [
        p.receivedByUserId,
        ...(p.reversedById ? [p.reversedById] : []),
      ]),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, name: true },
    });
    const patients = await this.prisma.patient.findMany({
      where: { id: { in: [...new Set(rows.map((c) => c.patientId))] } },
      select: { id: true, fullName: true, socialName: true },
    });
    const user = (id: string) => ({ id, name: users.find((u) => u.id === id)?.name ?? '' });
    return rows.map((c) => {
      const p = patients.find((x) => x.id === c.patientId);
      const payments: PaymentDto[] = c.payments.map((pay) => ({
        id: pay.id,
        chargeId: pay.chargeId,
        method: pay.method,
        amountCents: pay.amountCents,
        paidAt: pay.paidAt.toISOString(),
        receivedBy: user(pay.receivedByUserId),
        reversedAt: pay.reversedAt?.toISOString() ?? null,
        reversedBy: pay.reversedById ? user(pay.reversedById) : null,
        reverseReason: pay.reverseReason,
      }));
      return {
        id: c.id,
        unitId: c.unitId,
        patient: { id: c.patientId, name: p ? (p.socialName ?? p.fullName) : '' },
        appointmentId: c.appointmentId,
        priceItemId: c.priceItemId,
        description: c.description,
        amountCents: c.amountCents,
        discountCents: c.discountCents,
        ...chargeTotals(c),
        cancelledAt: c.cancelledAt?.toISOString() ?? null,
        cancelReason: c.cancelReason,
        createdBy: user(c.createdByUserId),
        createdAt: c.createdAt.toISOString(),
        payments,
      };
    });
  }
}
