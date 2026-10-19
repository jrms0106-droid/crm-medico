/**
 * Popula o banco de DESENVOLVIMENTO com dados fictícios.
 * Recusa-se a rodar com NODE_ENV=production. Pode ser executado várias vezes.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';

if (process.env['NODE_ENV'] === 'production') {
  throw new Error('O seed de dados fictícios não pode rodar em produção.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] ?? '' }),
});

const ORG_NAME = 'Clínica Exemplo (fictícia)';

const existing = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
const org = existing ?? (await prisma.organization.create({ data: { name: ORG_NAME } }));

await prisma.unit.upsert({
  where: { organizationId_name: { organizationId: org.id, name: 'Unidade Centro' } },
  update: {},
  create: { organizationId: org.id, name: 'Unidade Centro' },
});

console.log(`Dados fictícios prontos: organização "${org.name}" com 1 unidade.`);
await prisma.$disconnect();
