# Architecture

## Principle

Server-authoritative, with a pure game engine. Clients send **intents**
(`Action`); the server validates and applies them through the engine and sends
each player a **redacted view** of the state plus the resulting **events**.

```
applyAction(catalog, state, player, action) -> Result<{ state, events }>
```

The engine (`packages/engine`) has no network, database or clock access. All
randomness comes from a seeded PRNG whose state lives in `GameState.rngState`,
so a game can be replayed exactly from its seed and action log.

## Packages

| Package | Role |
|---|---|
| `packages/engine` | Types, rules, validation, effects. Pure TypeScript. |
| `packages/server` (later) | Fastify, WebSockets, PostgreSQL, auth, game rooms. |
| `packages/web` (later) | React + Vite client. |

## Data model notes

- Cards are **data** (id, stats, attacks); effects are **code** referenced by `handler` name.
- `CardInstance { iid, cardId }`: `iid` is unique per physical card in a game (`p0-17`).
- `CreatureInPlay.stack` is the evolution stack; attached cards and damage survive evolution.
- Players are `0 | 1` inside the engine; the server maps user ids to indices.
- Coin flip convention: heads = player 0 starts.
- State is plain JSON (cloned with a JSON round-trip), so it can be stored in Postgres as JSONB.

## Runtime (planned)

- Active games live in memory in a `GameRoom` that processes one action at a time.
- Every action is appended to `game_actions`; snapshots are saved periodically for recovery.
- The server never sends hidden data (opponent hand, deck order, prizes); it sends counts only.
- One active game per player is enforced with a database constraint.

## Turn state machine

`GameState.turnStage` is `main` -> `ending` -> `between` -> next turn's `main`.
After every action `settle()` checks win conditions, waits while
`pendingDecisions` is non-empty (e.g. a player must PROMOTE after a knockout),
runs the between-turns checkup, and starts the next turn (draw included).

## Effects

Item cards, abilities and custom attack effects name a handler in card data.
Handlers live in an `EffectRegistry` (`defaultEffects` has `heal` and `draw`);
pass your own registry as the 5th argument of `applyAction`. Card parameters
are trusted (`ctx.params`); player choices are not (`ctx.input`, validate them).

## Testing strategy

- Rule-by-rule unit tests build exact board situations with `makeState()` and force coin flips with `rngFor()`.
- `simulateGame()` plays whole games between bots (`chooseAction` over `legalActions`); the fuzz test runs dozens of them
  and checks structural invariants (`test/invariants.ts`) after every action, plus determinism and non-mutation.
- `legalActions()` validates every candidate through `applyAction`, so it can never disagree with the engine.

## Backend (packages/server)

Fastify + Drizzle ORM + PostgreSQL. `buildApp()` assembles the server without listening, so tests use
`app.inject()`. SQL migrations in `migrations/*.sql` are applied by a small runner (`db:migrate`);
`src/db/schema.ts` mirrors them for typed queries and must be kept in sync by hand.
Sessions are random tokens in an httpOnly cookie; only their SHA-256 hash is stored. Passwords use
scrypt (Node built-in) with the cost parameters stored inside each hash. Deck validity is computed with
the engine on every read, so the rules live in exactly one place.

## Game server (Phase 6)

```
browser --WebSocket--> ws.ts --> GameManager --> GameRoom --> engine.applyAction
browser --REST-------> routes/games.ts --^            |
                                              GameStore (PostgreSQL / memory)
```

- **GameManager** (one per server process): lobby rules, who is connected, which room each player is
  in, recovery at startup. **GameRoom**: one running game. All changes pass through a queue, so requests
  never interleave. Each accepted action is **saved first, then applied and broadcast**; if the save
  fails the move is refused and the game is unchanged.
- **Hidden information** is protected by construction: only `viewFor(state, seat)` output leaves the
  server. A fuzz test checks every state of complete games for leaked card ids.
- **Recovery**: a game is `decks + seed + action log`. The engine is deterministic, so replaying the
  log rebuilds the exact state. (If the engine's rules change, old logs may no longer replay; such
  games are marked abandoned.)
- **Timers** use an injectable clock; tests drive them with a fake clock.
- **One game per player** is a partial unique index in PostgreSQL, so it holds under concurrent requests.
- Rooms live in memory, so this runs as **a single server process**. Scaling out later means routing
  each game to one instance (sticky routing by game id) and adding a pub/sub layer.

## Web client (packages/web)

React + Vite + plain CSS, no router or state library. Pages: sign-in, lobby, deck list, deck editor, game.
See `docs/CLIENT.md` for the layout and how to extend it. Types shared with the server (the per-player
view, WebSocket messages, REST response shapes) live in `packages/protocol`.

## Deployment

One Docker image holds the bundled server (`packages/server/scripts/build.mjs` inlines the engine and protocol
packages; third-party libraries are installed normally) and the built web client, which the server serves
itself, so one process answers `/`, `/api` and `/ws`. Caddy in front adds HTTPS and security headers.
See `docs/DEPLOY.md`.
