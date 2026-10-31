import { z } from 'zod';
import { type PatientCreateInput, patientCreateSchema } from './patients.js';
import { normalizeSearch, onlyDigits } from './text.js';

/** Importação de pacientes por planilha CSV (docs/api/integracoes.md). */
export const PATIENT_IMPORT_MAX_ROWS = 500;
export const PATIENT_IMPORT_MAX_BYTES = 256 * 1024;

/** Colunas reconhecidas, na ordem do modelo de planilha. */
export const PATIENT_IMPORT_COLUMNS = [
  'nome',
  'nome_social',
  'cpf',
  'data_nascimento',
  'telefone',
  'telefone_whatsapp',
  'email',
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
] as const;
export type PatientImportColumn = (typeof PATIENT_IMPORT_COLUMNS)[number];

const REQUIRED_COLUMNS: PatientImportColumn[] = ['nome', 'data_nascimento', 'telefone'];
const ADDRESS_COLUMNS: PatientImportColumn[] = [
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
];

/** Modelo de planilha com uma linha de exemplo fictícia. */
export const PATIENT_IMPORT_TEMPLATE =
  `${PATIENT_IMPORT_COLUMNS.join(';')}\n` +
  'Maria Fictícia de Souza;;;15/04/1985;11987654321;sim;maria@exemplo.invalid;' +
  '01001000;Praça da Sé;100;;Sé;São Paulo;SP\n';

/** Tamanho em bytes no UTF-8, sem depender de `TextEncoder` (o pacote roda no navegador e no Node). */
function byteLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

export const patientImportSchema = z.strictObject({
  csv: z
    .string()
    .min(1, 'Envie o conteúdo do arquivo.')
    .refine(
      (v) => byteLength(v) <= PATIENT_IMPORT_MAX_BYTES,
      `O arquivo pode ter no máximo ${PATIENT_IMPORT_MAX_BYTES / 1024} KB.`,
    ),
});

export type PatientImportLineStatus = 'ready' | 'error' | 'duplicate' | 'created';

export const PATIENT_IMPORT_STATUS_LABELS: Record<PatientImportLineStatus, string> = {
  ready: 'Pronta para entrar',
  error: 'Com erro',
  duplicate: 'Possível duplicidade',
  created: 'Cadastrada',
};

export interface PatientImportLineDto {
  /** Linha do arquivo (o cabeçalho é a linha 1). */
  line: number;
  name: string;
  status: PatientImportLineStatus;
  messages: string[];
  patientId: string | null;
}

export interface PatientImportResultDto {
  /** `false` na conferência; `true` quando as linhas prontas foram cadastradas. */
  committed: boolean;
  ignoredColumns: string[];
  totals: Record<PatientImportLineStatus, number>;
  lines: PatientImportLineDto[];
}

/**
 * Lê CSV (RFC 4180): campos entre aspas podem ter o separador, quebras de linha e aspas
 * dobradas. O separador é `;` ou `,`, o que aparecer mais no cabeçalho. Devolve cada registro
 * com a linha do arquivo em que começa.
 */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const src = text.replace(/^\uFEFF/, '');
  const headerEnd = src.search(/\r?\n/);
  const header = headerEnd === -1 ? src : src.slice(0, headerEnd);
  const delimiter =
    (header.match(/;/g)?.length ?? 0) >= (header.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      cells.push(cell);
      rows.push({ line: rowStart, cells });
      cells = [];
      cell = '';
      line++;
      rowStart = line;
    } else cell += ch;
  }
  if (cell !== '' || cells.length > 0) {
    cells.push(cell);
    rows.push({ line: rowStart, cells });
  }
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ''));
}

const columnKey = (h: string) => normalizeSearch(h).replace(/ /g, '_');

export type PreparedImport =
  | { ok: false; message: string }
  | {
      ok: true;
      ignoredColumns: string[];
      rows: { line: number; values: Partial<Record<PatientImportColumn, string>> }[];
    };

/** Confere o cabeçalho e o tamanho do arquivo e separa as linhas por coluna. */
export function prepareImport(csv: string): PreparedImport {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return { ok: false, message: 'O arquivo está vazio.' };
  const known = new Set<string>(PATIENT_IMPORT_COLUMNS);
  const keys = header.cells.map(columnKey);
  const missing = REQUIRED_COLUMNS.filter((c) => !keys.includes(c));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Cabeçalho sem as colunas obrigatórias: ${missing.join(', ')}. Use o modelo de planilha.`,
    };
  }
  if (rows.length === 0) return { ok: false, message: 'O arquivo não tem nenhum paciente.' };
  if (rows.length > PATIENT_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      message: `O arquivo tem ${rows.length} pacientes; o máximo por importação é ${PATIENT_IMPORT_MAX_ROWS}.`,
    };
  }
  const ignoredColumns = header.cells.filter((_, i) => !known.has(keys[i]!)).map((h) => h.trim());
  return {
    ok: true,
    ignoredColumns,
    rows: rows.map((r) => {
      const values: Partial<Record<PatientImportColumn, string>> = {};
      keys.forEach((k, i) => {
        if (known.has(k) && values[k as PatientImportColumn] === undefined) {
          values[k as PatientImportColumn] = (r.cells[i] ?? '').trim();
        }
      });
      return { line: r.line, values };
    }),
  };
}

const FIELD_COLUMNS: Record<string, PatientImportColumn> = {
  fullName: 'nome',
  socialName: 'nome_social',
  cpf: 'cpf',
  birthDate: 'data_nascimento',
  email: 'email',
  phones: 'telefone',
  'address.zip': 'cep',
  'address.street': 'logradouro',
  'address.number': 'numero',
  'address.complement': 'complemento',
  'address.district': 'bairro',
  'address.city': 'cidade',
  'address.state': 'uf',
};

function columnOf(path: PropertyKey[]): string {
  const [first, second] = path.map(String);
  if (first === 'phones') return 'telefone';
  return FIELD_COLUMNS[second ? `${first}.${second}` : (first ?? '')] ?? first ?? 'linha';
}

/** `DD/MM/AAAA` ou `AAAA-MM-DD` → `AAAA-MM-DD`; outra coisa → `null`. */
export function importDate(value: string): string | null {
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (br) return `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function importYesNo(value: string): boolean | null {
  const v = normalizeSearch(value);
  if (['', 'nao', 'n', 'no', 'false', '0'].includes(v)) return false;
  if (['sim', 's', 'yes', 'true', '1', 'x'].includes(v)) return true;
  return null;
}

/**
 * Converte uma linha em cadastro, pelas mesmas regras do cadastro manual. Comunicação nunca vem
 * da planilha: todo paciente importado entra sem nenhuma autorização.
 */
export function importRow(values: Partial<Record<PatientImportColumn, string>>): {
  input: PatientCreateInput | null;
  messages: string[];
} {
  const v = (c: PatientImportColumn) => values[c] ?? '';
  const messages: string[] = [];
  const birthDate = importDate(v('data_nascimento'));
  if (!birthDate) messages.push('data_nascimento: use DD/MM/AAAA.');
  const whatsapp = importYesNo(v('telefone_whatsapp'));
  if (whatsapp === null) messages.push('telefone_whatsapp: use sim ou não.');
  const hasAddress = ADDRESS_COLUMNS.some((c) => v(c) !== '');
  const body = {
    fullName: v('nome'),
    socialName: v('nome_social') || null,
    cpf: v('cpf') || null,
    birthDate: birthDate ?? '1900-01-01',
    email: v('email') || null,
    phones: v('telefone') ? [{ number: v('telefone'), whatsapp: whatsapp ?? false }] : [],
    address: hasAddress
      ? {
          zip: v('cep'),
          street: v('logradouro'),
          number: v('numero'),
          complement: v('complemento') || null,
          district: v('bairro'),
          city: v('cidade'),
          state: v('uf'),
        }
      : null,
  };
  const parsed = patientCreateSchema.safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const col = columnOf(issue.path);
      if (col === 'data_nascimento' && !birthDate) continue;
      const message = issue.message.startsWith('Data inválida')
        ? 'data inexistente; use DD/MM/AAAA.'
        : issue.message;
      messages.push(`${col}: ${message}`);
    }
  }
  if (messages.length > 0 || !parsed.success) return { input: null, messages };
  return { input: parsed.data, messages: [] };
}

/** Chaves para achar a mesma pessoa repetida dentro do arquivo. */
export function importIdentityKeys(input: PatientCreateInput): string[] {
  const keys = [`nome:${normalizeSearch(input.fullName)}|${input.birthDate}`];
  if (input.cpf) keys.push(`cpf:${onlyDigits(input.cpf)}`);
  return keys;
}
