import { starterCatalog } from '@cardgame/engine';
import { createDb } from './client.js';
import { seedCards } from './seed.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env)');

const { db, client } = createDb(url, { max: 1 });
try {
  const n = await seedCards(db, starterCatalog);
  console.log(`Seeded ${n} cards.`);
} finally {
  await client.end();
}
