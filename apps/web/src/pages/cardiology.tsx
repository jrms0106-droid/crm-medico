import { useId, useState } from 'react';
import {
  CHEST_PAIN_LABELS,
  parseNumberInput,
  type CardiologyContent,
  type CardiologyTrendsDto,
  TREND_COLUMNS,
  ECG_RHYTHM_LABELS,
  HISTORY_LABELS,
  RISK_FACTOR_LABELS,
  SMOKING_LABELS,
  SYMPTOM_LABELS,
  bodyMassIndex,
  cardiologyFacts,
} from '@crm/shared';
import { api } from '../api';
import { Alert, Panel, formatDate, formatDateTime, useLoad } from '../ui';
import { TrendCharts } from './trend-chart';

type Section = 'riskFactors' | 'history' | 'symptoms' | 'vitals' | 'ecg' | 'echo' | 'labs';
type SectionValue<S extends Section> = NonNullable<CardiologyContent[S]>;

/** Tira chaves vazias para a ficha gravada não guardar `{}` nem `undefined`. */
function clean<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined && v !== '');
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

/**
 * Campo numérico que guarda o texto digitado (para "80," ou "5." não sumirem no meio da
 * digitação) e entrega o número já convertido, aceitando vírgula decimal.
 */
function NumberField({
  label,
  unit,
  value,
  onChange,
  decimal = false,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  decimal?: boolean;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value).replace('.', ','));
  const errorId = useId();
  const invalid = text.trim() !== '' && parseNumberInput(text) === undefined;
  return (
    <label className="field">
      <span>
        {label} ({unit})
      </span>
      <input
        inputMode={decimal ? 'decimal' : 'numeric'}
        value={text}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => {
          setText(e.target.value);
          // Texto que não é número não guarda o valor anterior: o campo fica vazio na ficha
          // e o aviso diz isso, para o que está salvo nunca diferir do que aparece.
          onChange(parseNumberInput(e.target.value));
        }}
      />
      {invalid && (
        <span id={errorId} className="error small">
          Não é um número; este campo não será salvo.
        </span>
      )}
    </label>
  );
}

function Flags<K extends string>({
  labels,
  value,
  onChange,
}: {
  labels: Record<K, string>;
  value: object | undefined;
  onChange: (key: K, checked: boolean) => void;
}) {
  const current = value as Record<string, unknown> | undefined;
  return (
    <div className="grid">
      {(Object.keys(labels) as K[]).map((k) => (
        <label key={k} className="check">
          <input
            type="checkbox"
            checked={current?.[k] === true}
            onChange={(e) => onChange(k, e.target.checked)}
          />
          {labels[k]}
        </label>
      ))}
    </div>
  );
}

function Choice<V extends string>({
  label,
  labels,
  value,
  onChange,
}: {
  label: string;
  labels: Record<V, string>;
  value: V | undefined;
  onChange: (v: V | undefined) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || undefined) as V | undefined)}
      >
        <option value="">Não informado</option>
        {(Object.entries(labels) as [V, string][]).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const CLASSES = { '1': 'I', '2': 'II', '3': 'III', '4': 'IV' } as const;

/** Formulário estruturado da ficha de cardiologia (ADR 0037), dentro do rascunho. */
export function CardiologyEditor({
  value,
  onChange,
}: {
  value: CardiologyContent | undefined;
  onChange: (next: CardiologyContent | undefined) => void;
}) {
  const c = value ?? {};
  const set = <S extends Section>(section: S, patch: Partial<SectionValue<S>>) => {
    const merged = clean({ ...(c[section] ?? {}), ...patch } as SectionValue<S>);
    onChange(clean({ ...c, [section]: merged }));
  };
  const date = (section: 'ecg' | 'echo' | 'labs') => (
    <label className="field">
      <span>Data do exame</span>
      <input
        type="date"
        value={c[section]?.date ?? ''}
        onChange={(e) => set(section, { date: e.target.value || undefined })}
      />
    </label>
  );
  const findings = (section: 'ecg' | 'echo', label: string) => (
    <label className="field">
      <span>{label}</span>
      <textarea
        rows={2}
        value={c[section]?.findings ?? ''}
        onChange={(e) => set(section, { findings: e.target.value || undefined })}
      />
    </label>
  );
  const v = c.vitals;
  const bmi = bodyMassIndex(v);

  return (
    <fieldset aria-label="Ficha de cardiologia">
      <legend>Ficha de cardiologia</legend>
      <p className="muted small">
        Campos em teste, ainda sem conferência de um cardiologista. Deixe em branco o que não foi
        avaliado.
      </p>

      <h3>Fatores de risco</h3>
      <Flags
        labels={RISK_FACTOR_LABELS}
        value={c.riskFactors}
        onChange={(k, checked) => set('riskFactors', { [k]: checked || undefined })}
      />
      <Choice
        label="Tabagismo"
        labels={SMOKING_LABELS}
        value={c.riskFactors?.smoking}
        onChange={(smoking) => set('riskFactors', { smoking })}
      />

      <h3>Antecedentes cardiovasculares</h3>
      <Flags
        labels={HISTORY_LABELS}
        value={c.history}
        onChange={(k, checked) => set('history', { [k]: checked || undefined })}
      />

      <h3>Sintomas</h3>
      <div className="inline">
        <Choice
          label="Dor torácica"
          labels={CHEST_PAIN_LABELS}
          value={c.symptoms?.chestPain}
          onChange={(chestPain) => set('symptoms', { chestPain })}
        />
        <Choice
          label="Angina (classe CCS)"
          labels={CLASSES}
          value={c.symptoms?.ccsClass ? (String(c.symptoms.ccsClass) as '1') : undefined}
          onChange={(cls) => set('symptoms', { ccsClass: cls ? Number(cls) : undefined })}
        />
        <Choice
          label="Classe funcional (NYHA)"
          labels={CLASSES}
          value={c.symptoms?.nyhaClass ? (String(c.symptoms.nyhaClass) as '1') : undefined}
          onChange={(cls) => set('symptoms', { nyhaClass: cls ? Number(cls) : undefined })}
        />
      </div>
      <Flags
        labels={SYMPTOM_LABELS}
        value={c.symptoms}
        onChange={(k, checked) => set('symptoms', { [k]: checked || undefined })}
      />

      <h3>Sinais vitais</h3>
      <div className="grid">
        <NumberField
          label="PA sistólica"
          unit="mmHg"
          value={v?.systolicBp}
          onChange={(n) => set('vitals', { systolicBp: n })}
        />
        <NumberField
          label="PA diastólica"
          unit="mmHg"
          value={v?.diastolicBp}
          onChange={(n) => set('vitals', { diastolicBp: n })}
        />
        <NumberField
          label="Frequência cardíaca"
          unit="bpm"
          value={v?.heartRate}
          onChange={(n) => set('vitals', { heartRate: n })}
        />
        <NumberField
          label="Saturação"
          unit="%"
          value={v?.spo2}
          onChange={(n) => set('vitals', { spo2: n })}
        />
        <NumberField
          label="Peso"
          unit="kg"
          decimal
          value={v?.weightKg}
          onChange={(n) => set('vitals', { weightKg: n })}
        />
        <NumberField
          label="Altura"
          unit="cm"
          value={v?.heightCm}
          onChange={(n) => set('vitals', { heightCm: n })}
        />
        <NumberField
          label="Circunferência abdominal"
          unit="cm"
          value={v?.waistCm}
          onChange={(n) => set('vitals', { waistCm: n })}
        />
      </div>
      {bmi !== null && (
        <p className="small" aria-live="polite">
          IMC calculado: {bmi.toLocaleString('pt-BR')} kg/m²
        </p>
      )}

      <h3>Eletrocardiograma</h3>
      <div className="inline">
        {date('ecg')}
        <Choice
          label="Ritmo"
          labels={ECG_RHYTHM_LABELS}
          value={c.ecg?.rhythm}
          onChange={(rhythm) => set('ecg', { rhythm })}
        />
        <NumberField
          label="FC no ECG"
          unit="bpm"
          value={c.ecg?.heartRate}
          onChange={(n) => set('ecg', { heartRate: n })}
        />
      </div>
      {findings('ecg', 'Achados do ECG')}

      <h3>Ecocardiograma</h3>
      <div className="grid">
        {date('echo')}
        <NumberField
          label="FEVE"
          unit="%"
          value={c.echo?.lvef}
          onChange={(n) => set('echo', { lvef: n })}
        />
        <NumberField
          label="Diâmetro diastólico do VE"
          unit="mm"
          value={c.echo?.lvedd}
          onChange={(n) => set('echo', { lvedd: n })}
        />
        <NumberField
          label="Volume indexado do AE"
          unit="mL/m²"
          decimal
          value={c.echo?.laVolumeIndex}
          onChange={(n) => set('echo', { laVolumeIndex: n })}
        />
        <NumberField
          label="PSAP"
          unit="mmHg"
          value={c.echo?.pasp}
          onChange={(n) => set('echo', { pasp: n })}
        />
      </div>
      {findings('echo', 'Achados do ecocardiograma')}

      <h3>Exames laboratoriais</h3>
      <div className="grid">
        {date('labs')}
        {(
          [
            ['totalCholesterol', 'Colesterol total', 'mg/dL', false],
            ['ldl', 'LDL', 'mg/dL', false],
            ['hdl', 'HDL', 'mg/dL', false],
            ['triglycerides', 'Triglicerídeos', 'mg/dL', false],
            ['glucose', 'Glicemia de jejum', 'mg/dL', false],
            ['hba1c', 'Hemoglobina glicada', '%', true],
            ['creatinine', 'Creatinina', 'mg/dL', true],
            ['potassium', 'Potássio', 'mEq/L', true],
            ['ntProBnp', 'NT-proBNP', 'pg/mL', false],
          ] as const
        ).map(([key, label, unit, decimal]) => (
          <NumberField
            key={key}
            label={label}
            unit={unit}
            decimal={decimal}
            value={c.labs?.[key]}
            onChange={(n) => set('labs', { [key]: n })}
          />
        ))}
      </div>

      <label className="field">
        <span>Medicações em uso</span>
        <textarea
          rows={3}
          value={c.medications ?? ''}
          onChange={(e) => onChange(clean({ ...c, medications: e.target.value || undefined }))}
        />
      </label>
    </fieldset>
  );
}

/** Leitura da ficha: as mesmas linhas que vão na cópia FHIR. */
export function CardiologyView({ value }: { value: CardiologyContent | undefined }) {
  const facts = cardiologyFacts(value);
  if (facts.length === 0) return null;
  return (
    <>
      {facts.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </>
  );
}

/**
 * Evolução dos valores da ficha nas consultas assinadas (ADR 0038). Some quando o paciente não
 * tem ficha de cardiologia assinada; mostra só as colunas que têm algum valor.
 */
/**
 * Imprime só a evolução (ADR 0041): marca o corpo da página, abre a impressão do navegador e
 * desmarca ao terminar. O que sai na folha é decidido pelo CSS de impressão.
 */
function usePrintTrends() {
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  const print = () => {
    setPrintedAt(formatDateTime(new Date().toISOString()));
    document.body.classList.add('print-trend');
    const done = () => document.body.classList.remove('print-trend');
    window.addEventListener('afterprint', done, { once: true });
    // Espera o React pintar o cabeçalho com a hora antes de abrir a impressão.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  };
  return { printedAt, print };
}

export function CardiologyTrendsPanel({
  patientId,
  patient,
  printedBy,
  refreshKey,
  onOpen,
}: {
  patientId: string;
  /** Nome exibido e nascimento, para o cabeçalho da impressão; sem eles, não há botão. */
  patient: { displayName: string; birthDate: string } | undefined;
  printedBy: string;
  refreshKey: unknown;
  onOpen: (recordId: string) => void;
}) {
  const { printedAt, print } = usePrintTrends();
  const trends = useLoad(
    () => api.get<CardiologyTrendsDto>(`/patients/${patientId}/cardiology-trends`),
    [patientId, refreshKey],
  );
  const data = trends.data;
  if (trends.error) return <Alert message={trends.error} />;
  if (!data || (data.rows.length === 0 && data.withheld === 0)) return null;
  const columns = TREND_COLUMNS.filter((col) => data.rows.some((r) => r.values[col.key]));
  return (
    <div className="print-area">
      <Panel title="Evolução da cardiologia">
        <div className="print-only" data-testid="print-header">
          <p>
            <strong>{patient?.displayName}</strong>
            {patient && <> · nascimento {formatDate(patient.birthDate)}</>}
          </p>
          <p>
            Impresso em {printedAt ?? ''} por {printedBy}
          </p>
        </div>
        {patient && (
          <p className="no-print">
            <button type="button" onClick={print}>
              Imprimir evolução
            </button>
          </p>
        )}
        <p className="muted small">
          Valores das fichas de cardiologia assinadas, da mais antiga para a mais recente. O sistema
          não interpreta os valores.
        </p>
        {data.withheld > 0 && (
          <p className="muted small">
            {data.withheld} ficha(s) sensível(is) de outro profissional ficaram de fora.
          </p>
        )}
        <TrendCharts rows={data.rows} />
        {data.rows.length > 0 && (
          <div className="table-scroll">
            <table aria-label="Evolução dos valores da ficha de cardiologia">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  {columns.map((col) => (
                    <th key={col.key} scope="col">
                      {col.label}
                      {col.unit && <span className="muted small"> ({col.unit})</span>}
                    </th>
                  ))}
                  <th scope="col" className="no-print">
                    Registro
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.recordId}>
                    <th scope="row">{formatDate(row.clinicalDate)}</th>
                    {columns.map((col) => (
                      <td key={col.key}>{row.values[col.key] ?? '—'}</td>
                    ))}
                    <td className="no-print">
                      <button
                        type="button"
                        className="link"
                        aria-label={`Abrir o registro de ${formatDate(row.clinicalDate)}, de ${row.author.name}`}
                        onClick={() => onOpen(row.recordId)}
                      >
                        Abrir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
