import { execFileSync } from 'node:child_process';

/** Recria os dados fictícios antes de cada execução. */
export default function globalSetup() {
  execFileSync('npx', ['tsx', 'e2e/seed.ts'], { stdio: 'inherit' });
}
