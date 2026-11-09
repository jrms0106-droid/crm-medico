import type { PrismaService } from '../database/prisma.service.js';

/**
 * Dos atendimentos informados, quais foram feitos por teleconsulta (ADR 0044). A modalidade vem da
 * consulta que originou o atendimento; registros e documentos sem atendimento contam como
 * presenciais.
 */
export async function telemedicineEncounterIds(
  prisma: PrismaService,
  encounterIds: (string | null)[],
): Promise<Set<string>> {
  const ids = [...new Set(encounterIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Set();
  const rows = await prisma.encounter.findMany({
    where: { id: { in: ids }, appointment: { modality: 'telemedicine' } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}
