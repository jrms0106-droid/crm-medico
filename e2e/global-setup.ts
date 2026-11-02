import { execFileSync } from 'node:child_process';
import { E2E_TIMEZONE, clockOffsetMinutes, e2eNow } from './clock.js';

/** Recria os dados fictícios antes de cada execução. */
export default function globalSetup() {
  execFileSync('npx', ['tsx', 'e2e/seed.ts'], { stdio: 'inherit' });
  const shown = e2eNow().toLocaleString('pt-BR', { timeZone: E2E_TIMEZONE });
  console.warn(`Relógio dos testes: ${shown} (deslocamento de ${clockOffsetMinutes()} min).`);
}
