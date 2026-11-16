-- Phase 5 schema: accounts, sessions, card catalog, decks.

create table users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  constraint users_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);
-- Usernames are unique ignoring case ("Alice" and "alice" are the same user).
create unique index users_username_lower_idx on users (lower(username));

create table sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  -- Only a SHA-256 hash of the cookie token is stored, never the token itself.
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

-- Mirror of the engine's card catalog (filled by `pnpm db:seed`).
create table cards (
  id   text primary key,
  data jsonb not null
);

create table decks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index decks_user_id_idx on decks (user_id);

create table deck_cards (
  deck_id uuid not null references decks (id) on delete cascade,
  card_id text not null references cards (id),
  count   integer not null check (count > 0),
  primary key (deck_id, card_id)
);
