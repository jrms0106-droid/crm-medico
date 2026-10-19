/**
 * Popula o banco de DESENVOLVIMENTO com dados fictícios.
 * Recusa-se a rodar com NODE_ENV=production. Pode ser executado várias vezes.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizeSearch } from '@crm/shared';
import { PrismaClient, type Role } from '../apps/api/src/generated/prisma/client.js';
import { hashPassword } from '../apps/api/src/identity/password.js';

if (process.env['NODE_ENV'] === 'production') {
  throw new Error('O seed de dados fictícios não pode rodar em produção.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' }),
});

const ORG_NAME = 'Clínica Exemplo (fictícia)';
/** Senha pública, só para desenvolvimento local. */
const DEV_PASSWORD = 'senha-de-desenvolvimento';

const existing = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
const org = existing ?? (await prisma.organization.create({ data: { name: ORG_NAME } }));

const unit = await prisma.unit.upsert({
  where: { organizationId_name: { organizationId: org.id, name: 'Unidade Centro' } },
  update: {},
  create: { organizationId: org.id, name: 'Unidade Centro' },
});

const users: { name: string; email: string; roles: Role[] }[] = [
  { name: 'Ana Administradora (fictícia)', email: 'admin@clinica-ficticia.test', roles: ['admin'] },
  { name: 'Dr. Bruno Médico (fictício)', email: 'medico@clinica-ficticia.test', roles: ['doctor'] },
  {
    name: 'Carla Secretária (fictícia)',
    email: 'secretaria@clinica-ficticia.test',
    roles: ['secretary'],
  },
];

const passwordHash = await hashPassword(DEV_PASSWORD);
const created: Record<string, string> = {};
for (const u of users) {
  const user = await prisma.user.upsert({
    where: { email: u.email },
    update: {},
    create: { ...u, organizationId: org.id, passwordHash },
  });
  await prisma.unitMembership.upsert({
    where: { userId_unitId: { userId: user.id, unitId: unit.id } },
    update: {},
    create: { userId: user.id, unitId: unit.id },
  });
  created[u.email] = user.id;
}

const specialtyNames = ['Cardiologia', 'Clínica Médica', 'Dermatologia', 'Pediatria'];
const specialties = [];
for (const name of specialtyNames) {
  specialties.push(
    await prisma.specialty.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name },
    }),
  );
}

// CRM e RQE inventados, só para desenvolvimento.
const doctorId = created['medico@clinica-ficticia.test'] ?? '';
await prisma.professional.upsert({
  where: { userId: doctorId },
  update: {},
  create: {
    organizationId: org.id,
    userId: doctorId,
    crmNumber: '000001',
    crmState: 'SP',
    specialties: {
      create: [
        { specialtyId: specialties[0]?.id ?? '', rqe: '000001' },
        { specialtyId: specialties[1]?.id ?? '' },
      ],
    },
  },
});

// Pacientes fictícios, sem CPF (o CPF exige a chave de criptografia e não é necessário para testar).
const patients = [
  { fullName: 'José da Silva (fictício)', birthDate: '1980-05-20', phone: '11987654321' },
  {
    fullName: 'Maria Conceição Souza (fictícia)',
    socialName: 'Mel Souza',
    birthDate: '1992-11-03',
    phone: '11976543210',
  },
  { fullName: 'Antônio Pereira Lima (fictício)', birthDate: '1957-02-14', phone: '1132345678' },
];
const secretaryId = created['secretaria@clinica-ficticia.test'] ?? '';
for (const p of patients) {
  const exists = await prisma.patient.findFirst({
    where: { organizationId: org.id, fullName: p.fullName },
  });
  if (exists) continue;
  const row = await prisma.patient.create({
    data: {
      organizationId: org.id,
      fullName: p.fullName,
      socialName: p.socialName ?? null,
      nameSearch: normalizeSearch(`${p.fullName} ${p.socialName ?? ''}`),
      birthDate: new Date(`${p.birthDate}T00:00:00.000Z`),
      phones: { create: [{ number: p.phone, whatsapp: p.phone.length === 11, position: 0 }] },
    },
  });
  await prisma.patientVersion.create({
    data: {
      patientId: row.id,
      version: 1,
      changedAt: new Date(),
      changedByUserId: secretaryId,
      changedFields: ['created'],
      snapshot: { fullName: p.fullName, origem: 'seed' },
    },
  });
}

console.log(
  `Dados fictícios prontos: "${org.name}", 1 unidade, ${users.length} usuários, ` +
    `${specialtyNames.length} especialidades, 1 ficha profissional (CRM 000001/SP, fictício) ` +
    `e ${patients.length} pacientes.`,
);
console.log(`Senha de todos (só desenvolvimento): ${DEV_PASSWORD}`);
for (const u of users) console.log(`  ${u.email}  (${u.roles.join(', ')})`);
await prisma.$disconnect();
