import { describe, expect, it } from 'vitest';
import { professionalCreateSchema, userCreateSchema } from './org.js';

const UUID = '01920000-0000-7000-8000-000000000001';

describe('ficha profissional', () => {
  it('aceita CRM com dígitos e UF em minúsculas', () => {
    const parsed = professionalCreateSchema.parse({
      userId: UUID,
      crmNumber: '123456',
      crmState: 'sp',
    });
    expect(parsed).toEqual({ userId: UUID, crmNumber: '123456', crmState: 'SP', specialties: [] });
  });

  it('recusa CRM com letras, UF inexistente e especialidade repetida', () => {
    expect(
      professionalCreateSchema.safeParse({ userId: UUID, crmNumber: '12A', crmState: 'SP' })
        .success,
    ).toBe(false);
    expect(
      professionalCreateSchema.safeParse({ userId: UUID, crmNumber: '1', crmState: 'XX' }).success,
    ).toBe(false);
    const repeated = [{ specialtyId: UUID }, { specialtyId: UUID }];
    expect(
      professionalCreateSchema.safeParse({
        userId: UUID,
        crmNumber: '1',
        crmState: 'SP',
        specialties: repeated,
      }).success,
    ).toBe(false);
  });
});

describe('conta de usuário', () => {
  it('exige ao menos um papel e uma unidade, e remove repetições', () => {
    const base = { name: 'Pessoa Fictícia', email: 'Pessoa@Clinica-Ficticia.test' };
    expect(userCreateSchema.safeParse({ ...base, roles: [], unitIds: [UUID] }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...base, roles: ['doctor'], unitIds: [] }).success).toBe(
      false,
    );
    const parsed = userCreateSchema.parse({
      ...base,
      roles: ['doctor', 'doctor'],
      unitIds: [UUID, UUID],
    });
    expect(parsed).toMatchObject({
      email: 'pessoa@clinica-ficticia.test',
      roles: ['doctor'],
      unitIds: [UUID],
    });
  });
});
