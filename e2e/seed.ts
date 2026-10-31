/**
 * Prepara o banco dos testes ponta a ponta: apaga tudo e cria uma clínica fictícia com
 * administrador, médico (com agenda aberta o dia todo) e secretária. Só roda em banco de teste.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { SecretBox } from '../apps/api/src/identity/crypto.js';
import { hashPassword } from '../apps/api/src/identity/password.js';
import { E2E_PASSWORD, E2E_TOTP_SECRET, TEST_KEYS, USERS } from './fixtures.js';

const url = process.env['E2E_DATABASE_URL'] ?? process.env['DATABASE_URL_TEST'];
if (!url || !/_test\b|_e2e\b/.test(url)) {
  throw new Error('Os testes ponta a ponta só rodam num banco de teste (nome terminado em _test).');
}
// A mesma chave que playwright.config.ts entrega à API.
const mfaKey = TEST_KEYS.MFA_ENCRYPTION_KEY;

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
await db.$executeRawUnsafe(
  `TRUNCATE privacy.subject_requests, billing.payments, billing.charges, billing.price_items, documents.document_events, documents.medical_documents, records.access_justifications, records.record_events, records.record_versions, records.clinical_records,
    care.emergency_accesses, care.encounters, scheduling.appointment_events, scheduling.waitlist_entries,
    scheduling.appointments, scheduling.schedule_blocks, scheduling.schedule_rules, scheduling.schedules,
    patients.versions, patients.contacts, patients.phones, patients.patients, audit.events,
    org.professional_specialties, org.professionals, org.specialties, org.unit_memberships,
    identity.sessions, identity.users, org.units, org.organizations CASCADE`,
);

const org = await db.organization.create({ data: { name: 'Clínica E2E (fictícia)' } });
const unit = await db.unit.create({
  data: { organizationId: org.id, name: 'Unidade Teste', timezone: 'America/Sao_Paulo' },
});
const passwordHash = await hashPassword(E2E_PASSWORD);
const box = new SecretBox(mfaKey);
const roles = { admin: 'admin', doctor: 'doctor', secretary: 'secretary' } as const;
const ids: Record<string, string> = {};
for (const [key, u] of Object.entries(USERS)) {
  const user = await db.user.create({
    data: {
      organizationId: org.id,
      name: u.name,
      email: u.email,
      passwordHash,
      roles: [roles[key as keyof typeof roles]],
      mfaEnabled: u.mfa,
      mfaSecretEnc: u.mfa ? box.encrypt(E2E_TOTP_SECRET) : null,
      unitMemberships: { create: [{ unitId: unit.id }] },
    },
  });
  ids[key] = user.id;
}

const professional = await db.professional.create({
  data: {
    organizationId: org.id,
    userId: ids['doctor'] ?? '',
    crmNumber: '123456',
    crmState: 'SP',
  },
});
const schedule = await db.schedule.create({
  data: { organizationId: org.id, unitId: unit.id, professionalId: professional.id },
});
// Agenda aberta o dia todo, todos os dias, para o teste rodar a qualquer hora.
await db.scheduleRule.createMany({
  data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    scheduleId: schedule.id,
    weekday,
    startMinute: 0,
    endMinute: 24 * 60,
  })),
});
await db.$disconnect();
console.log('Banco e2e preparado com dados fictícios.');
