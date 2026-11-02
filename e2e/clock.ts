/**
 * Relógio dos testes no navegador (docs/adr/0035-relogio-controlado-nos-testes.md).
 *
 * Os testes marcam consultas "hoje". Perto da meia-noite não sobra horário livre no dia e o
 * teste falhava sem defeito nenhum no sistema. Por isso a API, o navegador e o gerador de
 * códigos de MFA andam todos com o mesmo deslocamento: o relógio começa às 10:00 (horário de
 * Brasília) do próximo horário 10:00 a partir de agora e segue andando normalmente.
 */
export const E2E_TIMEZONE = 'America/Sao_Paulo';
/** Brasília não tem horário de verão desde 2019: UTC−3 o ano todo. */
const UTC_OFFSET_HOURS = -3;
const START_HOUR = 10;
const DAY_MS = 86_400_000;

/** Minutos a somar a `now` para cair no próximo 10:00 de Brasília (0 a 1440, arredondado para cima). */
export function offsetToNextStart(now: Date): number {
  const local = new Date(now.getTime() + UTC_OFFSET_HOURS * 3_600_000);
  let target = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    START_HOUR - UTC_OFFSET_HOURS,
  );
  if (target < now.getTime()) target += DAY_MS;
  return Math.ceil((target - now.getTime()) / 60_000);
}

const ENV = 'E2E_CLOCK_OFFSET_MINUTES';

/**
 * Deslocamento desta execução. É calculado uma vez (na leitura do playwright.config) e guardado
 * no ambiente, que os processos de teste herdam; assim todos usam o mesmo valor. Quem quiser
 * forçar um horário define a variável antes de rodar.
 */
export function clockOffsetMinutes(): number {
  const fromEnv = process.env[ENV];
  if (fromEnv !== undefined && fromEnv !== '') {
    const value = Number(fromEnv);
    if (!Number.isInteger(value)) throw new Error(`${ENV} precisa ser um número inteiro.`);
    return value;
  }
  const value = offsetToNextStart(new Date());
  process.env[ENV] = String(value);
  return value;
}

/** "Agora" do ponto de vista da API e do navegador nos testes. */
export const e2eNow = (): Date => new Date(Date.now() + clockOffsetMinutes() * 60_000);
