import { describe, expect, it } from 'vitest';
import { bodyMassIndex, cardiologyFacts, cardiologySchema, trendValues } from './cardiology.js';
import { hasContent, recordContentSchema, recordCreateSchema } from './records.js';

describe('ficha de cardiologia', () => {
  it('aceita a ficha completa e a mostra em linhas, na ordem da tela', () => {
    const c = cardiologySchema.parse({
      riskFactors: { hypertension: true, dyslipidemia: true, diabetes: false, smoking: 'former' },
      history: { priorPci: true },
      symptoms: { chestPain: 'typical', ccsClass: 2, nyhaClass: 1, dyspnea: true },
      vitals: { systolicBp: 142, diastolicBp: 88, heartRate: 72, weightKg: 80.5, heightCm: 175 },
      ecg: { date: '2026-11-01', rhythm: 'sinus', heartRate: 70, findings: 'Sem alterações.' },
      echo: { lvef: 58, lvedd: 50, laVolumeIndex: 30.5, pasp: 28 },
      labs: { ldl: 132, hdl: 45, hba1c: 5.8, creatinine: 0.9 },
      medications: 'AAS 100 mg; atorvastatina 40 mg.',
    });
    expect(cardiologyFacts(c)).toEqual([
      {
        label: 'Fatores de risco',
        value: 'Hipertensão arterial; Dislipidemia; Ex-tabagista',
      },
      { label: 'Antecedentes cardiovasculares', value: 'Angioplastia coronária prévia' },
      { label: 'Sintomas', value: 'Angina típica; angina CCS II; NYHA I; Dispneia' },
      {
        label: 'Sinais vitais',
        value: 'PA 142/88 mmHg; FC 72 bpm; peso 80,5 kg; altura 175 cm; IMC 26,3 kg/m²',
      },
      {
        label: 'Eletrocardiograma',
        value: 'em 01/11/2026; ritmo sinusal; FC 70 bpm; Sem alterações.',
      },
      {
        label: 'Ecocardiograma',
        value: 'FEVE 58%; DDVE 50 mm; volume indexado do AE 30,5 mL/m²; PSAP 28 mmHg',
      },
      {
        label: 'Exames laboratoriais',
        value: 'LDL 132 mg/dL; HDL 45 mg/dL; HbA1c 5,8%; creatinina 0,9 mg/dL',
      },
      { label: 'Medicações em uso', value: 'AAS 100 mg; atorvastatina 40 mg.' },
    ]);
  });

  it('ficha vazia não gera linhas nem conta como conteúdo', () => {
    const content = recordContentSchema.parse({ cardiology: { riskFactors: { diabetes: false } } });
    expect(cardiologyFacts(content.cardiology)).toEqual([]);
    expect(hasContent(content)).toBe(false);
    expect(hasContent({ cardiology: { vitals: { heartRate: 60 } } })).toBe(true);
  });

  it('recusa valor fora da faixa, com mensagem que pede para conferir', () => {
    const r = cardiologySchema.safeParse({ echo: { lvef: 580 } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('Valor acima de 90 %: confira a digitação.');
    expect(cardiologySchema.safeParse({ vitals: { heartRate: 72.5 } }).success).toBe(false);
    expect(cardiologySchema.safeParse({ symptoms: { nyhaClass: 5 } }).success).toBe(false);
  });

  it('recusa diastólica maior ou igual à sistólica', () => {
    const r = cardiologySchema.safeParse({ vitals: { systolicBp: 80, diastolicBp: 90 } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['vitals', 'diastolicBp']);
  });

  it('recusa campo desconhecido', () => {
    expect(cardiologySchema.safeParse({ vitals: { pressao: 120 } }).success).toBe(false);
    expect(cardiologySchema.safeParse({ outro: {} }).success).toBe(false);
  });

  it('calcula o IMC só com peso e altura', () => {
    expect(bodyMassIndex({ weightKg: 70, heightCm: 170 })).toBe(24.2);
    expect(bodyMassIndex({ weightKg: 70 })).toBeNull();
    expect(bodyMassIndex(undefined)).toBeNull();
  });

  it('o registro novo usa o formulário genérico se nada for escolhido', () => {
    expect(recordCreateSchema.parse({}).form).toBe('generic');
    expect(recordCreateSchema.parse({ form: 'cardiology' }).form).toBe('cardiology');
    expect(recordCreateSchema.safeParse({ form: 'pediatria' }).success).toBe(false);
  });

  it('extrai os valores acompanhados na evolução, em texto', () => {
    expect(
      trendValues({
        vitals: { systolicBp: 130, diastolicBp: 80, heartRate: 64, weightKg: 70, heightCm: 170 },
        symptoms: { nyhaClass: 3 },
        labs: { hba1c: 6.1, creatinine: 1.25 },
        riskFactors: { diabetes: true },
      }),
    ).toEqual({
      bloodPressure: '130/80',
      heartRate: '64',
      weightKg: '70',
      bmi: '24,2',
      nyhaClass: 'III',
      hba1c: '6,1',
      creatinine: '1,25',
    });
    expect(trendValues({ vitals: { systolicBp: 120 } })).toEqual({ bloodPressure: '120' });
    expect(trendValues(undefined)).toEqual({});
  });
});
