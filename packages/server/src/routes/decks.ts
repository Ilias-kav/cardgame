import type { CardCatalog, DeckEntry } from '@cardgame/engine';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { deckCards, decks } from '../db/schema.js';
import {
  MAX_DECKS_PER_USER,
  findUnknownCards,
  mergeEntries,
  toDetail,
  toSummary,
} from '../decks/service.js';
import { AppError } from '../errors.js';
import { deckInputSchema, uuidSchema } from '../schemas.js';

interface Options {
  catalog: CardCatalog;
}

const notFound = () => new AppError(404, 'DECK_NOT_FOUND', 'Deck not found');

export const deckRoutes: FastifyPluginAsync<Options> = async (app, { catalog }) => {
  const { db } = app;
  const guard = { preHandler: app.requireUser };

  /** Parses and checks a request body; returns the merged card list. */
  function parseDeckBody(body: unknown) {
    const input = deckInputSchema.parse(body);
    const entries = mergeEntries(input.cards);
    const unknown = findUnknownCards(catalog, entries);
    if (unknown.length > 0) {
      throw new AppError(400, 'UNKNOWN_CARD', `Unknown card(s): ${unknown.join(', ')}`);
    }
    return { name: input.name, entries };
  }

  /** The current user's deck, or a 404 (also for other people's decks, so ids can't be probed). */
  async function loadOwnDeck(userId: string, rawId: string) {
    if (!uuidSchema.safeParse(rawId).success) throw notFound();
    const rows = await db
      .select()
      .from(decks)
      .where(and(eq(decks.id, rawId), eq(decks.userId, userId)))
      .limit(1);
    const deck = rows[0];
    if (!deck) throw notFound();
    const entries = await db
      .select({ cardId: deckCards.cardId, count: deckCards.count })
      .from(deckCards)
      .where(eq(deckCards.deckId, deck.id))
      .orderBy(deckCards.cardId);
    return { deck, entries };
  }

  app.get('/api/decks', guard, async (req) => {
    const userId = req.user!.id;
    const rows = await db
      .select()
      .from(decks)
      .where(eq(decks.userId, userId))
      .orderBy(desc(decks.updatedAt));

    const byDeck = new Map<string, DeckEntry[]>();
    if (rows.length > 0) {
      const all = await db
        .select()
        .from(deckCards)
        .where(
          inArray(
            deckCards.deckId,
            rows.map((d) => d.id),
          ),
        );
      for (const row of all) {
        const list = byDeck.get(row.deckId) ?? [];
        list.push({ cardId: row.cardId, count: row.count });
        byDeck.set(row.deckId, list);
      }
    }
    return { decks: rows.map((d) => toSummary(d, byDeck.get(d.id) ?? [], catalog)) };
  });

  app.post('/api/decks', guard, async (req, reply) => {
    const userId = req.user!.id;
    const { name, entries } = parseDeckBody(req.body);

    const deck = await db.transaction(async (tx) => {
      // Lock the user's row so two simultaneous requests cannot both pass the limit.
      await tx.execute(sql`select id from users where id = ${userId} for update`);
      const total = (await tx.select({ n: count() }).from(decks).where(eq(decks.userId, userId)))[0];
      if ((total?.n ?? 0) >= MAX_DECKS_PER_USER) {
        throw new AppError(409, 'DECK_LIMIT_REACHED', `You can have at most ${MAX_DECKS_PER_USER} decks`);
      }
      const created = (await tx.insert(decks).values({ userId, name }).returning())[0];
      if (!created) throw new Error('Deck insert returned no row');
      if (entries.length > 0) {
        await tx
          .insert(deckCards)
          .values(entries.map((e) => ({ deckId: created.id, cardId: e.cardId, count: e.count })));
      }
      return created;
    });
    return reply.code(201).send({ deck: toDetail(deck, entries, catalog) });
  });

  app.get<{ Params: { id: string } }>('/api/decks/:id', guard, async (req) => {
    const { deck, entries } = await loadOwnDeck(req.user!.id, req.params.id);
    return { deck: toDetail(deck, entries, catalog) };
  });

  // Replaces name and cards in ONE transaction: a failure leaves the old deck untouched.
  app.put<{ Params: { id: string } }>('/api/decks/:id', guard, async (req) => {
    const userId = req.user!.id;
    if (!uuidSchema.safeParse(req.params.id).success) throw notFound();
    const { name, entries } = parseDeckBody(req.body);
    const deckId = req.params.id;

    const deck = await db.transaction(async (tx) => {
      const updated = (
        await tx
          .update(decks)
          .set({ name, updatedAt: new Date() })
          .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
          .returning()
      )[0];
      if (!updated) throw notFound();
      await tx.delete(deckCards).where(eq(deckCards.deckId, deckId));
      if (entries.length > 0) {
        await tx
          .insert(deckCards)
          .values(entries.map((e) => ({ deckId, cardId: e.cardId, count: e.count })));
      }
      return updated;
    });
    return { deck: toDetail(deck, entries, catalog) };
  });

  app.delete<{ Params: { id: string } }>('/api/decks/:id', guard, async (req, reply) => {
    if (!uuidSchema.safeParse(req.params.id).success) throw notFound();
    const deleted = await db
      .delete(decks)
      .where(and(eq(decks.id, req.params.id), eq(decks.userId, req.user!.id)))
      .returning({ id: decks.id });
    if (deleted.length === 0) throw notFound();
    return reply.code(204).send();
  });
};
