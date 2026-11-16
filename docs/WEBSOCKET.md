# WebSocket protocol (Phase 6)

Live games run over one WebSocket per browser tab: `GET /ws`.

## Connecting

- The handshake is a normal HTTP request, so the `sid` session cookie authenticates it. No valid
  session: the server answers **401** and no socket is opened. A browser `Origin` that is not in
  `ALLOWED_ORIGINS` gets **403**.
- Messages are JSON text, at most 64 KB. A client sending more than ~20 messages per second
  (bursts of 40) is disconnected with code 1008.
- A user may have up to 5 connections open (several tabs). They all receive the same updates.
- The server pings every 30 s; connections that do not answer are closed.

## Client -> server

| Message | Meaning |
|---|---|
| `{ "type": "ping" }` | Answered with `pong`. |
| `{ "type": "game.sync" }` | Ask for a fresh `game.state` snapshot. |
| `{ "type": "game.action", "action": Action, "requestId"?: string }` | Do something in your game. `Action` is the engine's action type (`packages/engine/src/actions.ts`). |
| `{ "type": "game.forfeit" }` | Give up; the opponent wins. |

There is no "join game" message: you automatically receive updates for the one game you are in.
Anything malformed gets `error` with code `BAD_MESSAGE`; the connection stays open.

## Server -> client

| Message | When |
|---|---|
| `hello` `{ user, game: { id, status } \| null }` | First message on every connection. |
| `game.started` `{ gameId, seat, opponent, rematchOf }` | Your game began (an opponent joined, or a sudden-death rematch started). |
| `game.state` `{ gameId, seq, deadline, view }` | Full snapshot: on connect/reconnect and after `game.sync`. |
| `game.update` `{ gameId, seq, events, deadline, view }` | After every accepted action, to **both** players. `events` describe what happened (for animation and the log); `view` is the new state from your seat. `seq` counts accepted actions (0 = the opening deal). |
| `ack` `{ requestId? }` | Your `game.action` was accepted. |
| `error` `{ code, message, requestId? }` | Your message was refused. Engine codes (`NOT_YOUR_TURN`, `NOT_ENOUGH_POWER`, ...) come straight from the rules; others: `BAD_MESSAGE`, `NO_ACTIVE_GAME`, `GAME_OVER`, `PERSISTENCE_FAILED` (retry), `RATE_LIMITED`, `TOO_MANY_CONNECTIONS`. |
| `game.over` `{ gameId, outcome, rematchGameId }` | The game ended. `outcome = { winner: 0\|1\|null, reason }`. |
| `game.cancelled` `{ gameId, reason: "expired" }` | Your waiting game was cancelled. |
| `pong` | Answer to `ping`. |

`outcome.reason`: `prizes`, `no_creatures`, `deck_out`, `forfeit`, `timeout`, `disconnect`,
`abandoned` (nobody acted / everybody left; `winner` is null), `sudden_death_rematch`
(`winner` is null and `rematchGameId` is the new one-prize game, which is announced with `game.started`).

## The view (what you are allowed to know)

`view` is a `PlayerView` (`packages/server/src/game/view.ts`). Your hand is listed card by card;
the opponent's hand, both decks and both prize piles are **counts only**. During setup the
opponent's starting creatures stay hidden until both players have placed them. The raw game state,
the opponent's hand and the random generator state are never sent. Card instances have an `iid` (use it in actions)
and a `cardId` (look it up with `GET /api/cards`).

## Time limits

- Whoever the game is waiting for has `TURN_TIMEOUT_SECONDS` (default 120) to finish their turn, setup or
  promotion, otherwise they lose (`timeout`). If nobody acts during setup the game is `abandoned`.
  `deadline` (epoch ms) in `game.state`/`game.update` is when time runs out; the timer restarts when
  the situation changes (a new turn, a promotion), not after every move.
- A player with no open connection has `DISCONNECT_GRACE_SECONDS` (default 60) to come back, otherwise
  they lose (`disconnect`). If both are gone the game is `abandoned`.

## Reconnecting

Open a new socket. You receive `hello` and, if your game is running, `game.state`. After a server
restart running games are rebuilt from the database (decks + seed + action log), so players simply
reconnect within the grace period.

## Sequence example

```
alice: POST /api/games {deckId}            -> waiting
bob:   POST /api/games/:id/join {deckId}   -> alice and bob receive game.started, game.update(seq 0)
alice: {"type":"game.action","action":{"type":"SETUP_PLACE",...},"requestId":"1"}
       -> alice: ack      both: game.update(seq 1)
```
