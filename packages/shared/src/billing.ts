import { z } from 'zod';

/** Financeiro particular (docs/api/financeiro.md). Valores sempre em centavos. */
export const PAYMENT_METHODS = ['cash', 'pix', 'debit_card', 'credit_card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  debit_card: 'Cartão de débito',
  credit_card: 'Cartão de crédito',
  other: 'Outra',
};

export const CHARGE_STATUSES = ['open', 'partially_paid', 'paid', 'cancelled'] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  open: 'Em aberto',
  partially_paid: 'Pago em parte',
  paid: 'Quitada',
  cancelled: 'Cancelada',
};

/** R$ 100.000,00 em centavos. */
export const MAX_AMOUNT_CENTS = 10_000_000;

const cents = z
  .number()
  .int('Valor em centavos, sem frações.')
  .min(1, 'O valor precisa ser maior que zero.')
  .max(MAX_AMOUNT_CENTS, 'Valor acima do limite de R$ 100.000,00.');

const reason = z
  .string()
  .trim()
  .min(3, 'Escreva ao menos 3 caracteres.')
  .max(200, 'Máximo de 200 caracteres.');

export const priceItemCreateSchema = z.strictObject({
  name: z.string().trim().min(1, 'Informe o nome.').max(120, 'Máximo de 120 caracteres.'),
  amountCents: cents,
});

export const priceItemUpdateSchema = z
  .strictObject({
    name: priceItemCreateSchema.shape.name.optional(),
    amountCents: cents.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Informe ao menos um campo.');

export const priceListQuerySchema = z.strictObject({
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const chargeCreateSchema = z
  .strictObject({
    patientId: z.uuid('Paciente inválido.'),
    unitId: z.uuid('Unidade inválida.'),
    appointmentId: z.uuid('Consulta inválida.').optional(),
    priceItemId: z.uuid('Item inválido.').optional(),
    description: z
      .string()
      .trim()
      .min(1, 'Informe a descrição.')
      .max(200, 'Máximo de 200 caracteres.')
      .optional(),
    amountCents: cents.optional(),
    discountCents: z.number().int().min(0, 'Desconto não pode ser negativo.').default(0),
  })
  .refine((v) => v.priceItemId || (v.description && v.amountCents), {
    message: 'Escolha um item da tabela ou informe descrição e valor.',
  });

export const chargeListQuerySchema = z.strictObject({
  unitId: z.uuid('Unidade inválida.'),
  status: z.enum(CHARGE_STATUSES).optional(),
  patientId: z.uuid('Paciente inválido.').optional(),
  from: z.iso.date('Data inválida: use AAAA-MM-DD.').optional(),
  to: z.iso.date('Data inválida: use AAAA-MM-DD.').optional(),
});

export const chargeCancelSchema = z.strictObject({ reason });

export const paymentCreateSchema = z.strictObject({
  method: z.enum(PAYMENT_METHODS),
  amountCents: cents,
  paidAt: z.iso.datetime({ offset: true, message: 'Data e hora inválidas.' }).optional(),
});

export const paymentReverseSchema = z.strictObject({ reason });

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, 'Chave de idempotência curta demais.')
  .max(100, 'Chave de idempotência longa demais.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Chave de idempotência inválida.');

export const reportQuerySchema = z.strictObject({
  from: z.iso.date('Data inválida: use AAAA-MM-DD.'),
  to: z.iso.date('Data inválida: use AAAA-MM-DD.'),
  unitId: z.uuid('Unidade inválida.').optional(),
});

export interface PriceItemDto {
  id: string;
  name: string;
  amountCents: number;
  active: boolean;
}

export interface PaymentDto {
  id: string;
  chargeId: string;
  method: PaymentMethod;
  amountCents: number;
  paidAt: string;
  receivedBy: { id: string; name: string };
  reversedAt: string | null;
  reversedBy: { id: string; name: string } | null;
  reverseReason: string | null;
}

export interface ChargeDto {
  id: string;
  unitId: string;
  patient: { id: string; name: string };
  appointmentId: string | null;
  priceItemId: string | null;
  description: string;
  amountCents: number;
  discountCents: number;
  netCents: number;
  paidCents: number;
  balanceCents: number;
  status: ChargeStatus;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  payments: PaymentDto[];
}

export interface FinancialReportDto {
  from: string;
  to: string;
  unitId: string | null;
  charged: { count: number; grossCents: number; discountCents: number; netCents: number };
  received: { totalCents: number; byMethod: Record<PaymentMethod, number> };
  reversedCents: number;
  openCents: number;
  openCount: number;
}

/** 12345 → "R$ 123,45". */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Valor digitado em reais → centavos. Aceita "150", "150,5", "1.234,56" e "R$ 80,00".
 * Devolve null se não for um valor válido (mais de duas casas, letras, vazio).
 */
export function parseReais(text: string): number | null {
  const clean = text.replace(/R\$/i, '').replace(/\s/g, '');
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  const reais = Number(match[1]!.replaceAll('.', ''));
  const centavos = Number((match[2] ?? '0').padEnd(2, '0'));
  return reais * 100 + centavos;
}
