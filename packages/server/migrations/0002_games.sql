-- Phase 6: games, their players, and the action log used to recover games after a restart.

create table games (
  id           uuid primary key default gen_random_uuid(),
  status       text not null check (status in ('waiting', 'active', 'finished', 'cancelled')),
  creator_id   uuid not null references users (id) on delete cascade,
  -- uint32 seed of the engine's random generator, stored as a signed int32 (see db-store.ts).
  seed         integer,
  prize_count  smallint not null default 6 check (prize_count between 1 and 6),
  -- Set when this game is the sudden-death rematch of another one.
  rematch_of   uuid references games (id) on delete set null,
  winner_seat  smallint check (winner_seat in (0, 1)),
  end_reason   text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index games_status_idx on games (status, created_at);

create table game_players (
  game_id  uuid not null references games (id) on delete cascade,
  user_id  uuid not null references users (id) on delete cascade,
  seat     smallint not null check (seat in (0, 1)),
  deck_id  uuid references decks (id) on delete set null,
  -- Snapshot of the deck at game start, so later edits cannot change a running game.
  deck     jsonb not null,
  -- True while the player is in a waiting or active game.
  in_game  boolean not null default true,
  primary key (game_id, seat),
  unique (game_id, user_id)
);
-- The rule "a player can only be in one game at a time", enforced by the database itself.
create unique index game_players_one_active_game_per_user on game_players (user_id) where in_game;

create table game_actions (
  game_id    uuid not null references games (id) on delete cascade,
  seq        integer not null,
  seat       smallint not null check (seat in (0, 1)),
  action     jsonb not null,
  created_at timestamptz not null default now(),
  primary key (game_id, seq)
);
