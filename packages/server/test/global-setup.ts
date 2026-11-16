import { starterCatalog } from '@cardgame/engine';
import { createDb } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { seedCards } from '../src/db/seed.js';
import { TEST_DATABASE_URL } from './test-env.js';

/** Runs once before all tests: migrate and seed the test database. */
export default async function setup(): Promise<void> {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against "${dbName}": the database name must end in "_test" because tests delete data.`,
    );
  }
  const { db, client } = createDb(TEST_DATABASE_URL, { max: 1 });
  try {
    await migrate(client);
    await seedCards(db, starterCatalog);
  } catch (err) {
    throw new Error(
      `Could not prepare the test database (${(err as Error).message}). Is it running? Try: docker compose up -d`,
    );
  } finally {
    await client.end();
  }
}
