# HTTP API (Phase 5)

All endpoints live under `/api`, speak JSON and use one error format:

```json
{ "error": { "code": "DECK_NOT_FOUND", "message": "Deck not found" } }
```

`VALIDATION_ERROR` responses also carry `error.details`: a list of `{ path, message }`.
Authentication is a session cookie named `sid` (httpOnly, SameSite=Lax, `Secure` in production),
set by register/login and removed by logout. Browsers send it automatically.

## Auth

### `POST /api/auth/register`
Body: `{ "username": string, "password": string }`
- username: 3-20 characters, letters/digits/underscore, unique ignoring case
- password: 10-128 characters

`201` `{ "user": { "id", "username" } }` and a session cookie (the new user is logged in).
Errors: `400 VALIDATION_ERROR`, `409 USERNAME_TAKEN`, `429 RATE_LIMITED`.

### `POST /api/auth/login`
Body: `{ "username", "password" }` (username is case-insensitive)

`200` `{ "user": { "id", "username" } }` and a session cookie.
Errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS` (identical for a wrong password and an
unknown user), `429 RATE_LIMITED`.

### `POST /api/auth/logout`
`204`, no body. Ends the session and clears the cookie. Works even when not logged in.

### `GET /api/me` (login required)
`200` `{ "user": { "id", "username" } }`. Error: `401 UNAUTHENTICATED`.

Register and login are rate limited per IP (default 10 per minute).

## Cards

### `GET /api/cards` (login required)
`200` `{ "cards": Card[] }`, sorted by `id`. A card is exactly the engine's card definition
(`kind` is `creature`, `item` or `power`; see `packages/engine/src/cards.ts`).

## Decks (login required; you only ever see your own decks)

A deck is `{ "name": string (1-40 chars), "cards": [{ "cardId": string, "count": integer 1-999 }] }`.
**Unfinished decks may be saved**: only unknown card ids and bad counts are rejected. `valid` and
`errors` are computed from the engine rules every time a deck is read, never stored. A deck must
be `valid` before it can be used in a game (enforced in Phase 6). Duplicate `cardId` entries in one
request are merged.

Deck response (`detail`):

```json
{
  "id": "uuid", "name": "Fire",
  "cards": [{ "cardId": "embercub", "count": 4 }],
  "cardCount": 60, "valid": true, "errors": [],
  "createdAt": "ISO date", "updatedAt": "ISO date"
}
```

`errors` items: `{ code, message, cardId? }` with codes `WRONG_SIZE`, `TOO_MANY_COPIES`,
`NO_BASIC_CREATURE`, `UNKNOWN_CARD`, `INVALID_COUNT`.

| Endpoint | Success | Errors |
|---|---|---|
| `GET /api/decks` | `200 { decks: [{ id, name, cardCount, valid, updatedAt }] }`, most recently changed first | `401` |
| `POST /api/decks` | `201 { deck: detail }` | `400 VALIDATION_ERROR`, `400 UNKNOWN_CARD`, `409 DECK_LIMIT_REACHED` (max 20 decks), `401` |
| `GET /api/decks/:id` | `200 { deck: detail }` | `404 DECK_NOT_FOUND`, `401` |
| `PUT /api/decks/:id` | `200 { deck: detail }`; replaces name and cards atomically | `400`, `404 DECK_NOT_FOUND`, `401` |
| `DELETE /api/decks/:id` | `204` | `404 DECK_NOT_FOUND`, `401` |

Someone else's deck, a deleted deck and a malformed id all answer `404 DECK_NOT_FOUND`.

## Games (login required)

Lobby operations are plain HTTP; live play happens over the WebSocket (see `docs/WEBSOCKET.md`).
A player can be in **one** game at a time (waiting or running); this is enforced by the database.
Only a **valid** deck (60 cards, rules satisfied) can be used.

A game summary: `{ id, status: "waiting"|"active"|"finished"|"cancelled", seat: 0|1|null, players: [{ seat, username }], createdAt, startedAt, rematchOf }`.

| Endpoint | Success | Errors |
|---|---|---|
| `GET /api/games` | `200 { open: [{ id, creator: { username }, createdAt, mine }], current: summary \| null }` (`current` = your waiting or running game) | `401` |
| `POST /api/games` `{ deckId }` | `201 { game }` (status `waiting`; you are seat 0) | `400 DECK_INVALID` (`error.details` lists the rule violations), `404 DECK_NOT_FOUND`, `409 ALREADY_IN_GAME`, `400 VALIDATION_ERROR` |
| `POST /api/games/:id/join` `{ deckId }` | `200 { game }` (status `active`; you are seat 1; both players receive `game.started` on their sockets) | `400 DECK_INVALID`, `404 DECK_NOT_FOUND` / `GAME_NOT_FOUND`, `409 ALREADY_IN_GAME` / `GAME_NOT_OPEN` / `CANNOT_JOIN_OWN_GAME` |
| `GET /api/games/:id` | `200 { game }` (participants only) | `404 GAME_NOT_FOUND` |
| `DELETE /api/games/:id` | `204`; cancels your waiting game | `404 GAME_NOT_FOUND`, `409 GAME_NOT_OPEN` |

Waiting games nobody joins are cancelled after 30 minutes (the creator's socket receives `game.cancelled`).

## Other

- `GET /api/health` -> `200 { "ok": true }`, or `503 { "ok": false }` when the database is unreachable.
- Unknown routes -> `404 NOT_FOUND`; malformed JSON -> `400 BAD_REQUEST`; unexpected failures -> `500 INTERNAL_ERROR`.
