import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Action } from '@crm/policy';
import {
  type ChargeDto,
  ErrorCode,
  type FinancialReportDto,
  type PriceItemDto,
  chargeCancelSchema,
  chargeCreateSchema,
  chargeListQuerySchema,
  idempotencyKeySchema,
  paymentCreateSchema,
  paymentReverseSchema,
  priceItemCreateSchema,
  priceItemUpdateSchema,
  priceListQuerySchema,
  reportQuerySchema,
} from '@crm/shared';
import { AuthorizationService } from '../authz/authorization.service.js';
import { AppError } from '../common/app-error.js';
import { parseBody } from '../common/validation.js';
import { Auth } from '../identity/auth.decorators.js';
import type { AuthContext } from '../identity/session.service.js';
import { BillingService } from './billing.service.js';

const uuid = new ParseUUIDPipe();

/** Financeiro particular (docs/api/financeiro.md). Acesso sempre pela política. */
@Controller()
export class BillingController {
  constructor(
    @Inject(AuthorizationService) private readonly authz: AuthorizationService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  // ---- Tabela de preços ----

  @Get('billing/prices')
  async prices(@Auth() ctx: AuthContext, @Query() query: unknown): Promise<PriceItemDto[]> {
    await this.authz.authorize(ctx, 'view', { type: 'price_item' });
    const { includeInactive } = parseBody(priceListQuerySchema, query);
    return this.billing.listPrices(ctx.user.organizationId, includeInactive);
  }

  @Post('billing/prices')
  async createPrice(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<PriceItemDto> {
    await this.authz.authorize(ctx, 'create', { type: 'price_item' });
    return this.billing.createPrice(
      ctx.user.organizationId,
      parseBody(priceItemCreateSchema, body),
    );
  }

  @Patch('billing/prices/:id')
  async updatePrice(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<PriceItemDto> {
    const item = await this.billing.findPrice(ctx.user.organizationId, id);
    if (!item) return this.authz.notFound(ctx, 'edit', 'price_item', id, 'Item não encontrado.');
    await this.authz.authorize(ctx, 'edit', { type: 'price_item', id });
    return this.billing.updatePrice(id, parseBody(priceItemUpdateSchema, body));
  }

  // ---- Cobranças ----

  @Post('charges')
  async createCharge(@Auth() ctx: AuthContext, @Body() body: unknown): Promise<ChargeDto> {
    const input = parseBody(chargeCreateSchema, body);
    await this.requireUnit(ctx, 'create', input.unitId);
    await this.authz.authorize(ctx, 'create', {
      type: 'charge',
      unitId: input.unitId,
      patientId: input.patientId,
    });
    return this.billing.createCharge(ctx, input);
  }

  @Get('charges')
  async listCharges(@Auth() ctx: AuthContext, @Query() query: unknown): Promise<ChargeDto[]> {
    const q = parseBody(chargeListQuerySchema, query);
    await this.requireUnit(ctx, 'view', q.unitId);
    await this.authz.authorize(ctx, 'view', {
      type: 'charge',
      unitId: q.unitId,
      patientId: q.patientId,
    });
    return this.billing.listCharges(ctx.user.organizationId, q);
  }

  @Get('charges/:id')
  async getCharge(@Auth() ctx: AuthContext, @Param('id', uuid) id: string): Promise<ChargeDto> {
    return this.billing.chargeDto(await this.loadCharge(ctx, id, 'view'));
  }

  @Post('charges/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<ChargeDto> {
    const charge = await this.loadCharge(ctx, id, 'edit');
    return this.billing.cancelCharge(ctx, charge, parseBody(chargeCancelSchema, body).reason);
  }

  /** Registro de pagamento. A chave de idempotência evita registrar o mesmo pagamento duas vezes. */
  @Post('charges/:id/payments')
  async pay(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Body() body: unknown,
  ): Promise<ChargeDto> {
    const charge = await this.loadCharge(ctx, id, 'edit');
    if (!rawKey) {
      throw new AppError(
        400,
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'Falta o cabeçalho Idempotency-Key para registrar o pagamento.',
      );
    }
    const key = parseBody(idempotencyKeySchema, rawKey);
    return this.billing.pay(ctx, charge, key, parseBody(paymentCreateSchema, body));
  }

  /** Estorno: só o administrador, com reautenticação recente. */
  @Post('payments/:id/reverse')
  @HttpCode(200)
  async reverse(
    @Auth() ctx: AuthContext,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<ChargeDto> {
    const payment = await this.billing.findPayment(ctx.user.organizationId, id);
    if (!payment)
      return this.authz.notFound(ctx, 'correct', 'charge', id, 'Pagamento não encontrado.');
    await this.authz.authorize(ctx, 'correct', {
      type: 'charge',
      id: payment.chargeId,
      unitId: payment.charge.unitId,
      patientId: payment.charge.patientId,
    });
    this.authz.requireRecentReauth(ctx);
    return this.billing.reverse(ctx, payment, parseBody(paymentReverseSchema, body).reason);
  }

  // ---- Relatório ----

  @Get('billing/report')
  async report(@Auth() ctx: AuthContext, @Query() query: unknown): Promise<FinancialReportDto> {
    const q = parseBody(reportQuerySchema, query);
    if (q.unitId) await this.requireUnit(ctx, 'view', q.unitId);
    await this.authz.authorize(ctx, 'view', { type: 'financial_report', unitId: q.unitId });
    // Sem unidade: o administrador vê a organização toda; os demais, só as suas unidades.
    const all = ctx.user.roles.includes('admin');
    return this.billing.report(ctx.user.organizationId, all ? undefined : [...ctx.unitIds], q);
  }

  // ---- Apoio ----

  private async requireUnit(ctx: AuthContext, action: Action, unitId: string) {
    if (!(await this.billing.unitExists(ctx.user.organizationId, unitId))) {
      await this.authz.notFound(ctx, action, 'charge', unitId, 'Unidade não encontrada.');
    }
  }

  private async loadCharge(ctx: AuthContext, id: string, action: Action) {
    const charge = await this.billing.findCharge(ctx.user.organizationId, id);
    if (!charge) return this.authz.notFound(ctx, action, 'charge', id, 'Cobrança não encontrada.');
    await this.authz.authorize(ctx, action, {
      type: 'charge',
      id: charge.id,
      unitId: charge.unitId,
      patientId: charge.patientId,
    });
    return charge;
  }
}
