import { execFileSync } from 'node:child_process';
import 'dotenv/config';
import pg from 'pg';

/**
 * Prepara um banco de teste limpo antes dos testes de integração.
 * Por segurança, só aceita bancos cujo nome termina em "_test".
 */
export default async function setup(): Promise<void> {
  const url = process.env['DATABASE_URL_TEST'];
  if (!url) throw new Error('Defina DATABASE_URL_TEST (veja .env.example).');
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Recusado: o banco de teste "${dbName}" precisa terminar em "_test".`);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace
       WHERE nspname NOT LIKE 'pg\\_%' AND nspname NOT IN ('information_schema', 'public')`,
    );
    for (const { nspname } of rows) {
      await client.query(`DROP SCHEMA "${nspname}" CASCADE`);
    }
    await client.query('DROP TABLE IF EXISTS public._prisma_migrations');
  } finally {
    await client.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  process.env['DATABASE_URL'] = url;
}
