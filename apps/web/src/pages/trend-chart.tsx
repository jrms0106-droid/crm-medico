import { useState } from 'react';
import { type CardiologyTrendRowDto, type ChartKey, niceTicks } from '@crm/shared';
import { formatDate } from '../ui';

interface Series {
  key: ChartKey;
  label: string;
  /** Classe de cor (.series-1, .series-2), sempre na mesma ordem. */
  slot: 1 | 2;
}

interface ChartSpec {
  title: string;
  unit: string;
  series: Series[];
}

/** Um gráfico por medida, cada um com o próprio eixo (nunca dois eixos no mesmo gráfico). */
export const TREND_CHARTS: ChartSpec[] = [
  {
    title: 'Pressão arterial',
    unit: 'mmHg',
    series: [
      { key: 'systolicBp', label: 'Sistólica', slot: 1 },
      { key: 'diastolicBp', label: 'Diastólica', slot: 2 },
    ],
  },
  { title: 'LDL', unit: 'mg/dL', series: [{ key: 'ldl', label: 'LDL', slot: 1 }] },
  { title: 'FEVE', unit: '%', series: [{ key: 'lvef', label: 'FEVE', slot: 1 }] },
];

const W = 320;
const H = 180;
const PAD = { top: 16, right: 64, bottom: 28, left: 40 };
const DAY = 86_400_000;

interface Point {
  row: CardiologyTrendRowDto;
  value: number;
  x: number;
  y: number;
}

/**
 * Gráfico de linha em SVG, sem biblioteca. Mostra só depois de dois valores na mesma medida.
 * Passar o mouse num ponto mostra data, valor e autor abaixo do gráfico. Quem usa teclado ou
 * leitor de tela tem a descrição do gráfico e a tabela, com os mesmos valores.
 */
export function TrendChart({ spec, rows }: { spec: ChartSpec; rows: CardiologyTrendRowDto[] }) {
  const [active, setActive] = useState<{ series: Series; point: Point } | null>(null);
  const times = rows.map((r) => Date.parse(`${r.clinicalDate}T00:00:00Z`));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const values = rows.flatMap((r) =>
    spec.series.map((s) => r.numbers[s.key]).filter((v): v is number => v !== undefined),
  );
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const yMin = ticks[0] ?? 0;
  const yMax = ticks[ticks.length - 1] ?? 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  // Datas iguais (várias fichas no mesmo dia) ficam lado a lado, na ordem.
  const x = (i: number) =>
    t1 - t0 < DAY
      ? PAD.left + (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW)
      : PAD.left + (((times[i] ?? t0) - t0) / (t1 - t0)) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const lines = spec.series.map((series) => ({
    series,
    points: rows.flatMap((row, i) => {
      const value = row.numbers[series.key];
      return value === undefined ? [] : [{ row, value, x: x(i), y: y(value) }];
    }),
  }));
  const describe = lines
    .filter((l) => l.points.length > 0)
    .map((l) => {
      const first = l.points[0]!;
      const last = l.points[l.points.length - 1]!;
      return `${l.series.label}: de ${first.value} em ${formatDate(first.row.clinicalDate)} a ${last.value} em ${formatDate(last.row.clinicalDate)}`;
    })
    .join('; ');

  return (
    <figure className="trend-chart">
      <figcaption>
        <strong>{spec.title}</strong> <span className="muted small">({spec.unit})</span>
        {spec.series.length > 1 && (
          <span className="legend" aria-hidden="true">
            {spec.series.map((s) => (
              <span key={s.key} className="legend-item">
                <span className={`swatch series-${s.slot}`} /> {s.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${spec.title} em ${spec.unit}. ${describe}. Os valores estão na tabela abaixo.`}
      >
        {ticks.map((t) => (
          <g key={t} className="grid-line">
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
              {t.toLocaleString('pt-BR')}
            </text>
          </g>
        ))}
        <text className="axis-label" x={PAD.left} y={H - 8} textAnchor="start">
          {formatDate(rows[0]?.clinicalDate ?? '')}
        </text>
        <text className="axis-label" x={W - PAD.right} y={H - 8} textAnchor="end">
          {formatDate(rows[rows.length - 1]?.clinicalDate ?? '')}
        </text>
        {lines.map(({ series, points }) => {
          const last = points[points.length - 1];
          return (
            <g key={series.key} className={`series-${series.slot}`}>
              {points.length > 1 && (
                <polyline className="line" points={points.map((p) => `${p.x},${p.y}`).join(' ')} />
              )}
              {points.map((p) => (
                <circle key={p.row.recordId} className="dot" cx={p.x} cy={p.y} r={4} />
              ))}
              {last && (
                <text className="direct-label" x={last.x + 8} y={last.y} dy="0.32em">
                  {spec.series.length > 1 ? `${series.label} ${last.value}` : last.value}
                </text>
              )}
              {points.map((p) => (
                <circle
                  key={`hit-${p.row.recordId}`}
                  className="hit"
                  cx={p.x}
                  cy={p.y}
                  r={12}
                  onMouseEnter={() => setActive({ series, point: p })}
                  onMouseLeave={() => setActive(null)}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <p className="small chart-readout" aria-hidden="true">
        {active
          ? `${formatDate(active.point.row.clinicalDate)} · ${active.series.label}: ${active.point.value} ${spec.unit} · ${active.point.row.author.name}`
          : ' '}
      </p>
    </figure>
  );
}

/** Os gráficos com ao menos dois valores; com menos, a tabela basta. */
export function TrendCharts({ rows }: { rows: CardiologyTrendRowDto[] }) {
  const charts = TREND_CHARTS.map((spec) => ({
    spec,
    rows: rows.filter((r) => spec.series.some((s) => r.numbers[s.key] !== undefined)),
  })).filter((c) => c.rows.length >= 2);
  if (charts.length === 0) return null;
  return (
    <div className="trend-charts">
      {charts.map((c) => (
        <TrendChart key={c.spec.title} spec={c.spec} rows={c.rows} />
      ))}
    </div>
  );
}
