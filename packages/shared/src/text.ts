/**
 * Normaliza texto para busca: sem acentos, minúsculas, só letras e números separados por espaço.
 * "José da Silva-Ramos" → "jose da silva ramos".
 */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Mantém só os dígitos. */
export function onlyDigits(input: string): string {
  return input.replace(/\D/g, '');
}
