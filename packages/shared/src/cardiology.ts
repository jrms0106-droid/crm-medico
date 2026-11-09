import { z } from 'zod';

/**
 * Ficha de cardiologia (ADR 0037): campos estruturados que o médico preenche além do texto livre
 * do formulário genérico. Tudo é opcional; os limites só barram erro de digitação, não definem o
 * que é normal. Os campos ainda precisam da conferência de um cardiologista.
 */
export const CARDIOLOGY_FORM_VERSION = 'cardiology-v1';

const shortText = z.string().max(2000, 'Máximo de 2.000 caracteres.');
const flag = z.boolean().optional();
const num = (min: number, max: number, unit: string, step: 'int' | 'decimal' = 'int') => {
  const base = z
    .number({ error: `Informe um número em ${unit}.` })
    .min(min, `Valor abaixo de ${min} ${unit}: confira a digitação.`)
    .max(max, `Valor acima de ${max} ${unit}: confira a digitação.`);
  return (step === 'int' ? base.int(`Use número inteiro em ${unit}.`) : base).optional();
};
const isoDate = z.iso.date('Data inválida: use AAAA-MM-DD.').optional();

export const SMOKING_STATUSES = ['never', 'former', 'current'] as const;
export const CHEST_PAIN_TYPES = ['none', 'typical', 'atypical', 'non_anginal'] as const;
export const ECG_RHYTHMS = [
  'sinus',
  'atrial_fibrillation',
  'atrial_flutter',
  'paced',
  'other',
] as const;
const functionalClass = z.number().int().min(1).max(4).optional();

export const RISK_FACTOR_LABELS = {
  hypertension: 'Hipertensão arterial',
  diabetes: 'Diabetes',
  dyslipidemia: 'Dislipidemia',
  obesity: 'Obesidade',
  ckd: 'Doença renal crônica',
  sedentary: 'Sedentarismo',
  familyHistory: 'História familiar de doença coronária precoce',
} as const;
export const HISTORY_LABELS = {
  priorMi: 'Infarto prévio',
  priorPci: 'Angioplastia coronária prévia',
  priorCabg: 'Cirurgia de revascularização prévia',
  heartFailure: 'Insuficiência cardíaca',
  atrialFibrillation: 'Fibrilação atrial',
  stroke: 'AVC ou AIT prévio',
  valveDisease: 'Valvopatia',
  pacemaker: 'Marca-passo ou CDI',
} as const;
export const SYMPTOM_LABELS = {
  dyspnea: 'Dispneia',
  palpitations: 'Palpitações',
  syncope: 'Síncope ou pré-síncope',
  edema: 'Edema de membros inferiores',
} as const;
export const SMOKING_LABELS: Record<(typeof SMOKING_STATUSES)[number], string> = {
  never: 'Nunca fumou',
  former: 'Ex-tabagista',
  current: 'Tabagista atual',
};
export const CHEST_PAIN_LABELS: Record<(typeof CHEST_PAIN_TYPES)[number], string> = {
  none: 'Sem dor torácica',
  typical: 'Angina típica',
  atypical: 'Angina atípica',
  non_anginal: 'Dor não anginosa',
};
export const ECG_RHYTHM_LABELS: Record<(typeof ECG_RHYTHMS)[number], string> = {
  sinus: 'Sinusal',
  atrial_fibrillation: 'Fibrilação atrial',
  atrial_flutter: 'Flutter atrial',
  paced: 'Ritmo de marca-passo',
  other: 'Outro',
};

const flags = <K extends string>(labels: Record<K, string>) =>
  z.strictObject(
    Object.fromEntries(Object.keys(labels).map((k) => [k, flag])) as Record<K, typeof flag>,
  );

export const cardiologySchema = z
  .strictObject({
    riskFactors: flags(RISK_FACTOR_LABELS)
      .extend({ smoking: z.enum(SMOKING_STATUSES).optional() })
      .optional(),
    history: flags(HISTORY_LABELS).optional(),
    symptoms: flags(SYMPTOM_LABELS)
      .extend({
        chestPain: z.enum(CHEST_PAIN_TYPES).optional(),
        ccsClass: functionalClass,
        nyhaClass: functionalClass,
      })
      .optional(),
    vitals: z
      .strictObject({
        systolicBp: num(50, 300, 'mmHg'),
        diastolicBp: num(20, 200, 'mmHg'),
        heartRate: num(20, 250, 'bpm'),
        weightKg: num(2, 400, 'kg', 'decimal'),
        heightCm: num(40, 250, 'cm'),
        waistCm: num(30, 250, 'cm'),
        spo2: num(50, 100, '%'),
      })
      .refine((v) => !(v.systolicBp && v.diastolicBp) || v.diastolicBp < v.systolicBp, {
        message: 'A pressão diastólica precisa ser menor que a sistólica.',
        path: ['diastolicBp'],
      })
      .optional(),
    ecg: z
      .strictObject({
        date: isoDate,
        rhythm: z.enum(ECG_RHYTHMS).optional(),
        heartRate: num(20, 250, 'bpm'),
        findings: shortText.optional(),
      })
      .optional(),
    echo: z
      .strictObject({
        date: isoDate,
        lvef: num(5, 90, '%'),
        lvedd: num(20, 100, 'mm'),
        laVolumeIndex: num(5, 200, 'mL/m²', 'decimal'),
        pasp: num(5, 150, 'mmHg'),
        findings: shortText.optional(),
      })
      .optional(),
    labs: z
      .strictObject({
        date: isoDate,
        totalCholesterol: num(50, 1000, 'mg/dL'),
        ldl: num(5, 800, 'mg/dL'),
        hdl: num(5, 200, 'mg/dL'),
        triglycerides: num(10, 5000, 'mg/dL'),
        glucose: num(20, 1000, 'mg/dL'),
        hba1c: num(3, 20, '%', 'decimal'),
        creatinine: num(0.1, 20, 'mg/dL', 'decimal'),
        potassium: num(1.5, 9, 'mEq/L', 'decimal'),
        ntProBnp: num(5, 100_000, 'pg/mL'),
      })
      .optional(),
    medications: shortText.optional(),
  })
  .optional();
export type CardiologyContent = NonNullable<z.infer<typeof cardiologySchema>>;

/** IMC em kg/m², com uma casa, quando peso e altura foram informados. */
export function bodyMassIndex(v: CardiologyContent['vitals']): number | null {
  if (!v?.weightKg || !v.heightCm) return null;
  const m = v.heightCm / 100;
  return Math.round((v.weightKg / (m * m)) * 10) / 10;
}

export interface CardiologyFact {
  label: string;
  value: string;
}

/** Classes CCS e NYHA são escritas em algarismos romanos, como na prática. */
const ROMAN = ['I', 'II', 'III', 'IV'] as const;
const br = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const brDate = (d: string) => d.split('-').reverse().join('/');
const marked = <K extends string>(values: object | undefined, labels: Record<K, string>) =>
  (Object.keys(labels) as K[])
    .filter((k) => (values as Record<string, unknown> | undefined)?.[k] === true)
    .map((k) => labels[k]);

/**
 * A ficha em linhas de texto, na mesma ordem da tela. Usada na leitura do registro e na cópia
 * FHIR, para as duas mostrarem exatamente o mesmo.
 */
export function cardiologyFacts(c: CardiologyContent | undefined): CardiologyFact[] {
  if (!c) return [];
  const facts: CardiologyFact[] = [];
  /** Partes vazias, zero ou ausentes ficam de fora. */
  const push = (label: string, parts: unknown[]) => {
    const value = parts.filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (value.length > 0) facts.push({ label, value: value.join('; ') });
  };

  const rf = c.riskFactors;
  push('Fatores de risco', [
    ...marked(rf, RISK_FACTOR_LABELS),
    rf?.smoking && SMOKING_LABELS[rf.smoking],
  ]);
  push('Antecedentes cardiovasculares', marked(c.history, HISTORY_LABELS));

  const s = c.symptoms;
  push('Sintomas', [
    s?.chestPain && CHEST_PAIN_LABELS[s.chestPain],
    s?.ccsClass && `angina CCS ${ROMAN[s.ccsClass - 1]}`,
    s?.nyhaClass && `NYHA ${ROMAN[s.nyhaClass - 1]}`,
    ...marked(s, SYMPTOM_LABELS),
  ]);

  const v = c.vitals;
  const bmi = bodyMassIndex(v);
  push('Sinais vitais', [
    v?.systolicBp && v.diastolicBp
      ? `PA ${v.systolicBp}/${v.diastolicBp} mmHg`
      : v?.systolicBp && `PA sistólica ${v.systolicBp} mmHg`,
    v?.heartRate && `FC ${v.heartRate} bpm`,
    v?.spo2 && `SpO₂ ${v.spo2}%`,
    v?.weightKg && `peso ${br(v.weightKg)} kg`,
    v?.heightCm && `altura ${v.heightCm} cm`,
    bmi !== null && `IMC ${br(bmi)} kg/m²`,
    v?.waistCm && `cintura ${v.waistCm} cm`,
  ]);

  const e = c.ecg;
  push('Eletrocardiograma', [
    e?.date && `em ${brDate(e.date)}`,
    e?.rhythm && `ritmo ${ECG_RHYTHM_LABELS[e.rhythm].toLowerCase()}`,
    e?.heartRate && `FC ${e.heartRate} bpm`,
    e?.findings?.trim(),
  ]);

  const ec = c.echo;
  push('Ecocardiograma', [
    ec?.date && `em ${brDate(ec.date)}`,
    ec?.lvef && `FEVE ${ec.lvef}%`,
    ec?.lvedd && `DDVE ${ec.lvedd} mm`,
    ec?.laVolumeIndex && `volume indexado do AE ${br(ec.laVolumeIndex)} mL/m²`,
    ec?.pasp && `PSAP ${ec.pasp} mmHg`,
    ec?.findings?.trim(),
  ]);

  const l = c.labs;
  push('Exames laboratoriais', [
    l?.date && `em ${brDate(l.date)}`,
    l?.totalCholesterol && `CT ${l.totalCholesterol} mg/dL`,
    l?.ldl && `LDL ${l.ldl} mg/dL`,
    l?.hdl && `HDL ${l.hdl} mg/dL`,
    l?.triglycerides && `TG ${l.triglycerides} mg/dL`,
    l?.glucose && `glicemia ${l.glucose} mg/dL`,
    l?.hba1c && `HbA1c ${br(l.hba1c)}%`,
    l?.creatinine && `creatinina ${br(l.creatinine)} mg/dL`,
    l?.potassium && `potássio ${br(l.potassium)} mEq/L`,
    l?.ntProBnp && `NT-proBNP ${l.ntProBnp} pg/mL`,
  ]);

  push('Medicações em uso', [c.medications?.trim()]);
  return facts;
}

/** Valores acompanhados na evolução (ADR 0038), na ordem das colunas da tabela. */
export const TREND_COLUMNS = [
  { key: 'bloodPressure', label: 'PA', unit: 'mmHg' },
  { key: 'heartRate', label: 'FC', unit: 'bpm' },
  { key: 'weightKg', label: 'Peso', unit: 'kg' },
  { key: 'bmi', label: 'IMC', unit: 'kg/m²' },
  { key: 'nyhaClass', label: 'NYHA', unit: '' },
  { key: 'lvef', label: 'FEVE', unit: '%' },
  { key: 'ldl', label: 'LDL', unit: 'mg/dL' },
  { key: 'hdl', label: 'HDL', unit: 'mg/dL' },
  { key: 'triglycerides', label: 'TG', unit: 'mg/dL' },
  { key: 'hba1c', label: 'HbA1c', unit: '%' },
  { key: 'creatinine', label: 'Creatinina', unit: 'mg/dL' },
  { key: 'ntProBnp', label: 'NT-proBNP', unit: 'pg/mL' },
] as const;
export type TrendKey = (typeof TREND_COLUMNS)[number]['key'];

/** Um valor por coluna, já em texto (PA como "142/88"); coluna sem valor fica de fora. */
export function trendValues(c: CardiologyContent | undefined): Partial<Record<TrendKey, string>> {
  if (!c) return {};
  const v = c.vitals;
  const bmi = bodyMassIndex(v);
  const raw: Record<TrendKey, number | string | null | undefined> = {
    bloodPressure:
      v?.systolicBp && v.diastolicBp ? `${v.systolicBp}/${v.diastolicBp}` : v?.systolicBp,
    heartRate: v?.heartRate,
    weightKg: v?.weightKg,
    bmi,
    nyhaClass: c.symptoms?.nyhaClass && ROMAN[c.symptoms.nyhaClass - 1],
    lvef: c.echo?.lvef,
    ldl: c.labs?.ldl,
    hdl: c.labs?.hdl,
    triglycerides: c.labs?.triglycerides,
    hba1c: c.labs?.hba1c,
    creatinine: c.labs?.creatinine,
    ntProBnp: c.labs?.ntProBnp,
  };
  const out: Partial<Record<TrendKey, string>> = {};
  for (const { key } of TREND_COLUMNS) {
    const value = raw[key];
    if (typeof value === 'string') out[key] = value;
    else if (typeof value === 'number') out[key] = br(value);
  }
  return out;
}

/** Números desenhados nos gráficos da evolução (ADR 0039). */
export const CHART_KEYS = ['systolicBp', 'diastolicBp', 'ldl', 'lvef'] as const;
export type ChartKey = (typeof CHART_KEYS)[number];

export function chartNumbers(c: CardiologyContent | undefined): Partial<Record<ChartKey, number>> {
  const raw: Record<ChartKey, number | undefined> = {
    systolicBp: c?.vitals?.systolicBp,
    diastolicBp: c?.vitals?.diastolicBp,
    ldl: c?.labs?.ldl,
    lvef: c?.echo?.lvef,
  };
  return Object.fromEntries(
    Object.entries(raw).filter(([, v]) => typeof v === 'number'),
  ) as Partial<Record<ChartKey, number>>;
}

export interface CardiologyTrendRowDto {
  recordId: string;
  clinicalDate: string;
  author: { id: string; name: string };
  values: Partial<Record<TrendKey, string>>;
  numbers: Partial<Record<ChartKey, number>>;
}

export interface CardiologyTrendsDto {
  /** Fichas de cardiologia assinadas, da mais antiga para a mais recente. */
  rows: CardiologyTrendRowDto[];
  /** Fichas sensíveis de outros profissionais, que ficaram de fora. */
  withheld: number;
}
