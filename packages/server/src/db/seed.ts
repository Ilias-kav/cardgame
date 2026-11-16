import type { CardCatalog } from '@cardgame/engine';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { cards } from './schema.js';

/** Copies the engine's card catalog into the `cards` table. Idempotent. */
export async function seedCards(db: Db, catalog: CardCatalog): Promise<number> {
  const rows = Object.values(catalog).map((card) => ({ id: card.id, data: card }));
  if (rows.length === 0) return 0;
  await db
    .insert(cards)
    .values(rows)
    .onConflictDoUpdate({ target: cards.id, set: { data: sql`excluded.data` } });
  return rows.length;
}
