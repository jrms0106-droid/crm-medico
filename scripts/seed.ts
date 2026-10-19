/**
 * Popula o banco de DESENVOLVIMENTO com dados fictícios.
 * Recusa-se a rodar com NODE_ENV=production. Pode ser executado várias vezes.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
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

await prisma.unit.upsert({
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
for (const u of users) {
  await prisma.user.upsert({
    where: { email: u.email },
    update: {},
    create: { ...u, organizationId: org.id, passwordHash },
  });
}

console.log(`Dados fictícios prontos: "${org.name}", 1 unidade e ${users.length} usuários.`);
console.log(`Senha de todos (só desenvolvimento): ${DEV_PASSWORD}`);
for (const u of users) console.log(`  ${u.email}  (${u.roles.join(', ')})`);
await prisma.$disconnect();
