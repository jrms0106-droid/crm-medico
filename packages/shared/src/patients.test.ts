import { describe, expect, it } from 'vitest';
import {
  ageOn,
  maskCpf,
  patientCreateSchema,
  patientSearchSchema,
  similarNames,
} from './patients.js';
import { normalizeSearch } from './text.js';

const base = {
  fullName: 'José da Silva',
  birthDate: '1980-05-20',
  phones: [{ number: '(11) 98765-4321' }],
};

describe('normalização para busca', () => {
  it('remove acentos, maiúsculas e pontuação', () => {
    expect(normalizeSearch('  José da SILVA-Ramos ')).toBe('jose da silva ramos');
    expect(normalizeSearch('Conceição Ávila')).toBe('conceicao avila');
  });
});

describe('cadastro de paciente', () => {
  it('aceita o mínimo e aplica padrões seguros de comunicação', () => {
    const parsed = patientCreateSchema.parse(base);
    expect(parsed.phones).toEqual([{ number: '11987654321', whatsapp: false }]);
    expect(parsed.communication).toEqual({
      channels: [],
      appointmentReminders: false,
      marketing: false,
    });
    expect(parsed.guardians).toEqual([]);
  });

  it('recusa CPF inválido, telefone inválido e data futura de formato errado', () => {
    expect(patientCreateSchema.safeParse({ ...base, cpf: '123.456.789-00' }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...base, phones: [{ number: '1234' }] }).success).toBe(
      false,
    );
    expect(
      patientCreateSchema.safeParse({ ...base, phones: [{ number: '01987654321' }] }).success,
    ).toBe(false);
    expect(patientCreateSchema.safeParse({ ...base, birthDate: '20/05/1980' }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...base, birthDate: '1899-12-31' }).success).toBe(false);
    expect(patientCreateSchema.safeParse({ ...base, phones: [] }).success).toBe(false);
  });

  it('aceita fixo de 10 dígitos e celular de 11', () => {
    const ok = patientCreateSchema.parse({
      ...base,
      phones: [{ number: '1132345678' }, { number: '21987654321', whatsapp: true }],
    });
    expect(ok.phones.map((p) => p.number)).toEqual(['1132345678', '21987654321']);
  });

  it('só autoriza canal com o contato correspondente', () => {
    const noEmail = patientCreateSchema.safeParse({
      ...base,
      communication: { channels: ['email'], appointmentReminders: true, marketing: false },
    });
    expect(noEmail.success).toBe(false);
    const noWhatsapp = patientCreateSchema.safeParse({
      ...base,
      communication: { channels: ['whatsapp'], appointmentReminders: true, marketing: false },
    });
    expect(noWhatsapp.success).toBe(false);
    const landlineSms = patientCreateSchema.safeParse({
      ...base,
      phones: [{ number: '1132345678' }],
      communication: { channels: ['sms'], appointmentReminders: true, marketing: false },
    });
    expect(landlineSms.success).toBe(false);
    const ok = patientCreateSchema.safeParse({
      ...base,
      email: 'jose@exemplo-ficticio.test',
      phones: [{ number: '11987654321', whatsapp: true }],
      communication: {
        channels: ['email', 'whatsapp', 'sms'],
        appointmentReminders: true,
        marketing: false,
      },
    });
    expect(ok.success).toBe(true);
  });

  it('busca exige ao menos 2 caracteres e tipos do JSON', () => {
    expect(patientSearchSchema.safeParse({ q: 'jo', limit: '5' }).success).toBe(false);
    expect(patientSearchSchema.safeParse({ q: 'j' }).success).toBe(false);
    expect(patientSearchSchema.parse({ q: 'jo' })).toEqual({
      q: 'jo',
      includeInactive: false,
      limit: 20,
    });
  });
});

describe('utilitários', () => {
  it('mascara o CPF', () => {
    expect(maskCpf('529.982.247-25')).toBe('***.982.247-**');
  });

  it('calcula idade completa', () => {
    expect(ageOn('2010-06-15', '2028-06-14')).toBe(17);
    expect(ageOn('2010-06-15', '2028-06-15')).toBe(18);
  });

  it('compara nomes para alerta de duplicidade', () => {
    expect(similarNames('jose da silva', 'jose silva')).toBe(true);
    expect(similarNames('maria aparecida souza', 'maria souza')).toBe(true);
    expect(similarNames('joao pereira', 'carlos andrade')).toBe(false);
    expect(similarNames('ana', 'ana beatriz lima')).toBe(true);
    expect(similarNames('ana', 'mariana costa')).toBe(false);
  });
});
