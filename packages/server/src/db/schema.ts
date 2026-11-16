import type { Card } from '@cardgame/engine';
import { boolean, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Table definitions used for queries. The real schema (constraints, indexes)
 * lives in migrations/*.sql; keep the two in sync by hand.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export const cards = pgTable('cards', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<Card>().notNull(),
});

export const decks = pgTable('decks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const deckCards = pgTable('deck_cards', {
  deckId: uuid('deck_id')
    .notNull()
    .references(() => decks.id, { onDelete: 'cascade' }),
  cardId: text('card_id')
    .notNull()
    .references(() => cards.id),
  count: integer('count').notNull(),
});

export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: text('status').notNull(),
  creatorId: uuid('creator_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  seed: integer('seed'),
  prizeCount: smallint('prize_count').notNull().default(6),
  rematchOf: uuid('rematch_of'),
  winnerSeat: smallint('winner_seat'),
  endReason: text('end_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const gamePlayers = pgTable('game_players', {
  gameId: uuid('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  seat: smallint('seat').notNull(),
  deckId: uuid('deck_id'),
  deck: jsonb('deck').$type<Array<{ cardId: string; count: number }>>().notNull(),
  inGame: boolean('in_game').notNull().default(true),
});

export const gameActions = pgTable('game_actions', {
  gameId: uuid('game_id')
    .notNull()
    .references(() => games.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  seat: smallint('seat').notNull(),
  action: jsonb('action').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
