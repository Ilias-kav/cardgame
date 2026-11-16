import type { Action, DeckEntry, PlayerIndex } from '@cardgame/engine';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { deckCards, decks, gameActions, gamePlayers, games, users } from '../db/schema.js';
import { AppError } from '../errors.js';
import type { DeckSource } from './manager.js';
import type { GameStore, RematchRequest } from './store.js';
import type { GameRecord, GameStatus, LoggedAction, Outcome, WaitingGame } from './types.js';

/** The engine seed is a uint32; the column is a signed int32. These convert both ways. */
const toDbSeed = (seed: number): number => seed | 0;
const fromDbSeed = (value: number | null): number | null => (value === null ? null : value >>> 0);

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

function first<T>(rows: T[], what: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`Expected ${what} but the query returned no row`);
  return row;
}

const alreadyInGame = () => new AppError(409, 'ALREADY_IN_GAME', 'You are already in a game');

/**
 * PostgreSQL implementation of GameStore. The rule "one game per player" is enforced by the
 * partial unique index on game_players(user_id) where in_game, so it holds even when two
 * requests race; a violation surfaces as ALREADY_IN_GAME.
 */
export class DrizzleGameStore implements GameStore {
  constructor(private readonly db: Db) {}

  async createWaiting(input: { creatorId: string; deckId: string | null; deck: DeckEntry[] }) {
    try {
      const gameId = await this.db.transaction(async (tx) => {
        const game = first(
          await tx
            .insert(games)
            .values({ status: 'waiting', creatorId: input.creatorId })
            .returning({ id: games.id }),
          'the new game',
        );
        await tx.insert(gamePlayers).values({
          gameId: game.id,
          userId: input.creatorId,
          seat: 0,
          deckId: input.deckId,
          deck: input.deck,
        });
        return game.id;
      });
      return await this.mustGet(gameId);
    } catch (error) {
      if (isUniqueViolation(error)) throw alreadyInGame();
      throw error;
    }
  }

  async join(input: { gameId: string; userId: string; deckId: string | null; deck: DeckEntry[]; seed: number }) {
    try {
      await this.db.transaction(async (tx) => {
        // Lock the game row: two people joining at once are handled one after the other.
        const rows = await tx.select().from(games).where(eq(games.id, input.gameId)).for('update');
        const game = rows[0];
        if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
        if (game.status !== 'waiting') throw new AppError(409, 'GAME_NOT_OPEN', 'This game is no longer open');
        if (game.creatorId === input.userId) {
          throw new AppError(409, 'CANNOT_JOIN_OWN_GAME', 'You cannot join your own game');
        }
        await tx.insert(gamePlayers).values({
          gameId: input.gameId,
          userId: input.userId,
          seat: 1,
          deckId: input.deckId,
          deck: input.deck,
        });
        await tx
          .update(games)
          .set({ status: 'active', seed: toDbSeed(input.seed), startedAt: new Date() })
          .where(eq(games.id, input.gameId));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw alreadyInGame();
      throw error;
    }
    return this.mustGet(input.gameId);
  }

  async cancel(gameId: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(games)
        .where(and(eq(games.id, gameId), eq(games.creatorId, userId)))
        .for('update');
      const game = rows[0];
      if (!game) throw new AppError(404, 'GAME_NOT_FOUND', 'Game not found');
      if (game.status !== 'waiting') throw new AppError(409, 'GAME_NOT_OPEN', 'This game is no longer open');
      await tx.update(games).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(games.id, gameId));
      await tx.update(gamePlayers).set({ inGame: false }).where(eq(gamePlayers.gameId, gameId));
    });
  }

  private async mustGet(gameId: string): Promise<GameRecord> {
    const record = await this.getGame(gameId);
    if (!record) throw new Error(`Game ${gameId} disappeared right after it was written`);
    return record;
  }

  async listWaiting(): Promise<WaitingGame[]> {
    const rows = await this.db
      .select({
        id: games.id,
        creatorId: games.creatorId,
        creatorUsername: users.username,
        createdAt: games.createdAt,
      })
      .from(games)
      .innerJoin(users, eq(games.creatorId, users.id))
      .where(eq(games.status, 'waiting'))
      .orderBy(asc(games.createdAt));
    return rows;
  }

  async findCurrentFor(userId: string): Promise<GameRecord | null> {
    const rows = await this.db
      .select({ gameId: gamePlayers.gameId })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.userId, userId), eq(gamePlayers.inGame, true)))
      .limit(1);
    const row = rows[0];
    return row ? this.getGame(row.gameId) : null;
  }

  async getGame(gameId: string): Promise<GameRecord | null> {
    const game = (await this.db.select().from(games).where(eq(games.id, gameId)).limit(1))[0];
    if (!game) return null;
    const players = await this.db
      .select({
        userId: gamePlayers.userId,
        username: users.username,
        seat: gamePlayers.seat,
        deck: gamePlayers.deck,
      })
      .from(gamePlayers)
      .innerJoin(users, eq(gamePlayers.userId, users.id))
      .where(eq(gamePlayers.gameId, gameId))
      .orderBy(asc(gamePlayers.seat));
    return {
      id: game.id,
      status: game.status as GameStatus,
      creatorId: game.creatorId,
      seed: fromDbSeed(game.seed),
      prizeCount: game.prizeCount,
      rematchOf: game.rematchOf,
      createdAt: game.createdAt,
      startedAt: game.startedAt,
      players: players.map((p) => ({
        userId: p.userId,
        username: p.username,
        seat: p.seat as PlayerIndex,
        deck: p.deck,
      })),
    };
  }

  async appendAction(gameId: string, seq: number, seat: PlayerIndex, action: Action): Promise<void> {
    await this.db
      .insert(gameActions)
      .values({ gameId, seq, seat, action: action as unknown as Record<string, unknown> });
  }

  async finishGame(gameId: string, outcome: Outcome, rematch?: RematchRequest): Promise<GameRecord | null> {
    const rematchId = await this.db.transaction(async (tx) => {
      await tx
        .update(games)
        .set({
          status: 'finished',
          winnerSeat: outcome.winner,
          endReason: outcome.reason,
          finishedAt: new Date(),
        })
        .where(eq(games.id, gameId));
      await tx.update(gamePlayers).set({ inGame: false }).where(eq(gamePlayers.gameId, gameId));
      if (!rematch) return null;

      // Same transaction: nobody can slip into another game between the two.
      const old = first(await tx.select().from(games).where(eq(games.id, gameId)), 'the finished game');
      const players = await tx
        .select()
        .from(gamePlayers)
        .where(eq(gamePlayers.gameId, gameId))
        .orderBy(asc(gamePlayers.seat));
      const created = first(
        await tx
          .insert(games)
          .values({
            status: 'active',
            creatorId: old.creatorId,
            seed: toDbSeed(rematch.seed),
            prizeCount: rematch.prizeCount,
            rematchOf: gameId,
            startedAt: new Date(),
          })
          .returning({ id: games.id }),
        'the rematch',
      );
      await tx.insert(gamePlayers).values(
        players.map((p) => ({
          gameId: created.id,
          userId: p.userId,
          seat: p.seat,
          deckId: p.deckId,
          deck: p.deck,
        })),
      );
      return created.id;
    });
    return rematchId ? this.getGame(rematchId) : null;
  }

  async loadActive(): Promise<Array<{ game: GameRecord; actions: LoggedAction[] }>> {
    const ids = await this.db.select({ id: games.id }).from(games).where(eq(games.status, 'active'));
    const result: Array<{ game: GameRecord; actions: LoggedAction[] }> = [];
    for (const { id } of ids) {
      const game = await this.getGame(id);
      if (!game) continue;
      const rows = await this.db
        .select()
        .from(gameActions)
        .where(eq(gameActions.gameId, id))
        .orderBy(asc(gameActions.seq));
      result.push({
        game,
        actions: rows.map((r) => ({
          seq: r.seq,
          seat: r.seat as PlayerIndex,
          action: r.action as unknown as Action,
        })),
      });
    }
    return result;
  }

  async expireWaiting(before: Date): Promise<Array<{ gameId: string; creatorId: string }>> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(games)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(and(eq(games.status, 'waiting'), lt(games.createdAt, before)))
        .returning({ id: games.id, creatorId: games.creatorId });
      if (rows.length > 0) {
        await tx
          .update(gamePlayers)
          .set({ inGame: false })
          .where(
            inArray(
              gamePlayers.gameId,
              rows.map((r) => r.id),
            ),
          );
      }
      return rows.map((r) => ({ gameId: r.id, creatorId: r.creatorId }));
    });
  }
}

/** Loads a user's saved deck from PostgreSQL for the game lobby. */
export class DbDeckSource implements DeckSource {
  constructor(private readonly db: Db) {}

  async loadDeck(userId: string, deckId: string) {
    const deck = (
      await this.db
        .select({ id: decks.id })
        .from(decks)
        .where(and(eq(decks.id, deckId), eq(decks.userId, userId)))
        .limit(1)
    )[0];
    if (!deck) return null;
    const entries = await this.db
      .select({ cardId: deckCards.cardId, count: deckCards.count })
      .from(deckCards)
      .where(eq(deckCards.deckId, deck.id))
      .orderBy(asc(deckCards.cardId));
    return { id: deck.id, entries };
  }
}
