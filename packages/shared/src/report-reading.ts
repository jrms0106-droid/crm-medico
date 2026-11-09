import { z } from 'zod';
import type { AiModelInfoDto } from './ai.js';
import { type CardiologyContent, cardiologySchema } from './cardiology.js';

/**
 * Leitura de laudo (IA nível 2, ADR 0042): o médico cola o texto de um laudo e o assistente aponta,
 * entre os números que estão no texto, quais vão para quais campos da ficha de cardiologia. O
 * valor mostrado é sempre o número como está no laudo; o modelo só devolve códigos.
 */
export const REPORT_TEXT_MAX_CHARS = 8000;
export const REPORT_MAX_NUMBERS = 200;

/** Campos numéricos do ecocardiograma e dos exames que a leitura pode sugerir. */
export const REPORT_FIELDS = [
  'echo.lvef',
  'echo.lvedd',
  'echo.laVolumeIndex',
  'echo.pasp',
  'labs.totalCholesterol',
  'labs.ldl',
  'labs.hdl',
  'labs.triglycerides',
  'labs.glucose',
  'labs.hba1c',
  'labs.creatinine',
  'labs.potassium',
  'labs.ntProBnp',
] as const;
export type ReportField = (typeof REPORT_FIELDS)[number];

export const REPORT_FIELD_INFO: Record<ReportField, { label: string; unit: string }> = {
  'echo.lvef': { label: 'FEVE', unit: '%' },
  'echo.lvedd': { label: 'DDVE', unit: 'mm' },
  'echo.laVolumeIndex': { label: 'Volume indexado do AE', unit: 'mL/m²' },
  'echo.pasp': { label: 'PSAP', unit: 'mmHg' },
  'labs.totalCholesterol': { label: 'Colesterol total', unit: 'mg/dL' },
  'labs.ldl': { label: 'LDL', unit: 'mg/dL' },
  'labs.hdl': { label: 'HDL', unit: 'mg/dL' },
  'labs.triglycerides': { label: 'Triglicerídeos', unit: 'mg/dL' },
  'labs.glucose': { label: 'Glicemia de jejum', unit: 'mg/dL' },
  'labs.hba1c': { label: 'Hemoglobina glicada', unit: '%' },
  'labs.creatinine': { label: 'Creatinina', unit: 'mg/dL' },
  'labs.potassium': { label: 'Potássio', unit: 'mEq/L' },
  'labs.ntProBnp': { label: 'NT-proBNP', unit: 'pg/mL' },
};

export interface ReportNumber {
  /** `N1`, `N2`... na ordem em que aparecem. */
  code: string;
  value: number;
  /** O número como está escrito no laudo. */
  raw: string;
  start: number;
  end: number;
}

// Número que não está colado a letra ou dígito antes ("HbA1c" não vira 1). Ponto seguido de três
// dígitos é milhar ("1.250" = 1250); vírgula ou ponto com outros dígitos é decimal.
const NUMBER = /(?<![\p{L}\d.,])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?!\d)/gu;

/** Todos os números do texto, com a posição, para o modelo apontar por código. */
export function extractNumbers(text: string): ReportNumber[] {
  return [...text.matchAll(NUMBER)].map((m, i) => {
    const raw = m[0];
    const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(',', '.');
    return {
      code: `N${i + 1}`,
      value: Number(normalized),
      raw,
      start: m.index,
      end: m.index + raw.length,
    };
  });
}

/** Trecho do laudo em volta do número, em uma linha, para o médico conferir de onde veio. */
export function reportExcerpt(text: string, n: ReportNumber, width = 40): string {
  const from = Math.max(0, n.start - width);
  const to = Math.min(text.length, n.end + 16);
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`;
}

const split = (field: ReportField) => field.split('.') as ['echo' | 'labs', string];

/** O valor cabe no campo da ficha (faixa e casas decimais da própria ficha)? */
export function fitsReportField(field: ReportField, value: number): boolean {
  const [section, key] = split(field);
  return cardiologySchema.safeParse({ [section]: { [key]: value } }).success;
}

/** Valor atual do campo na ficha, para mostrar o que será substituído. */
export function reportFieldValue(
  c: CardiologyContent | undefined,
  field: ReportField,
): number | undefined {
  const [section, key] = split(field);
  const value = (c?.[section] as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'number' ? value : undefined;
}

/** Ficha com o valor aplicado no campo. Não mexe em nenhum outro campo. */
export function withReportField(
  c: CardiologyContent | undefined,
  field: ReportField,
  value: number,
): CardiologyContent {
  const [section, key] = split(field);
  return { ...c, [section]: { ...c?.[section], [key]: value } };
}

export const reportReadingSchema = z.strictObject({
  patientId: z.uuid('Paciente inválido.'),
  text: z
    .string()
    .trim()
    .min(3, 'Cole o texto do laudo.')
    .max(REPORT_TEXT_MAX_CHARS, 'Máximo de 8.000 caracteres.'),
});

/** Saída do modelo: para cada campo, o código do número (`N3`). Nada de valor escrito. */
export const reportReadingOutputSchema = z.strictObject({
  values: z
    .array(
      z.strictObject({
        field: z.enum(REPORT_FIELDS),
        ref: z.string().regex(/^N\d{1,3}$/),
      }),
    )
    .max(REPORT_FIELDS.length),
});
export type ReportReadingOutput = z.infer<typeof reportReadingOutputSchema>;

export interface ReportSuggestionDto {
  field: ReportField;
  label: string;
  unit: string;
  value: number;
  raw: string;
  excerpt: string;
}

export interface ReportReadingSuggestionDto {
  requestId: string;
  suggestions: ReportSuggestionDto[];
  /** Números que o modelo apontou mas não cabem no campo; não são sugeridos. */
  outOfRange: ReportSuggestionDto[];
  model: AiModelInfoDto;
  notice: string;
}

export const AI_REPORT_NOTICE =
  'Sugestão do modelo simulado: o assistente só aponta números que estão no texto colado e não ' +
  'interpreta o laudo. Confira cada valor com o laudo; nada entra na ficha sem você usar, salvar ' +
  'e assinar.';
