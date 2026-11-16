import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';

/** `MIGRATIONS_DIR` overrides the default, which only fits running from source (the Docker image sets it). */
export const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * Applies every migrations/*.sql file that has not run yet, in filename order,
 * each in its own transaction. Safe to run repeatedly. Returns the files applied.
 */
export async function migrate(client: postgres.Sql, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  await client`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;

  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    const already = await client`select 1 from schema_migrations where name = ${file}`;
    if (already.length > 0) continue;

    const text = await readFile(path.join(dir, file), 'utf8');
    await client.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    applied.push(file);
  }
  return applied;
}
