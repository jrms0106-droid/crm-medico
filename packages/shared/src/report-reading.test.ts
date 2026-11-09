import { describe, expect, it } from 'vitest';
import {
  extractNumbers,
  fitsReportField,
  reportExcerpt,
  reportFieldValue,
  withReportField,
} from './report-reading.js';

describe('leitura de laudo: números do texto', () => {
  it('acha os números com vírgula, ponto decimal e milhar, sem pegar o 1 de HbA1c', () => {
    const text =
      'FEVE 58%; HbA1c 5,8%; creatinina 1.25 mg/dL; NT-proBNP 1.250 pg/mL; data 01/11/2026.';
    expect(extractNumbers(text).map((n) => [n.code, n.raw, n.value])).toEqual([
      ['N1', '58', 58],
      ['N2', '5,8', 5.8],
      ['N3', '1.25', 1.25],
      ['N4', '1.250', 1250],
      ['N5', '01', 1],
      ['N6', '11', 11],
      ['N7', '2026', 2026],
    ]);
  });

  it('mostra o trecho em volta do número, numa linha só', () => {
    const text =
      'Ecocardiograma.\nFEVE (Simpson):\n58%. Sem outras alterações dignas de nota no exame.';
    const n = extractNumbers(text)[0]!;
    expect(reportExcerpt(text, n)).toBe('Ecocardiograma. FEVE (Simpson): 58%. Sem outras al…');
  });

  it('confere o valor com a faixa e as casas decimais da ficha', () => {
    expect(fitsReportField('echo.lvef', 58)).toBe(true);
    expect(fitsReportField('echo.lvef', 580)).toBe(false);
    expect(fitsReportField('echo.lvef', 58.5)).toBe(false);
    expect(fitsReportField('labs.hba1c', 5.8)).toBe(true);
    expect(fitsReportField('labs.ntProBnp', 1250)).toBe(true);
  });

  it('coloca o valor no campo sem mexer nos outros', () => {
    const c = { echo: { lvedd: 50 }, labs: { ldl: 132 } };
    const next = withReportField(c, 'echo.lvef', 58);
    expect(next).toEqual({ echo: { lvedd: 50, lvef: 58 }, labs: { ldl: 132 } });
    expect(reportFieldValue(next, 'echo.lvef')).toBe(58);
    expect(reportFieldValue(undefined, 'labs.hdl')).toBeUndefined();
  });
});
