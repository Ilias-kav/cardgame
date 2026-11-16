# Web client

`packages/web`: React 19 + Vite + TypeScript, plain CSS. Run it with `pnpm dev:web`.

## How it is organised

Logic that can be tested without a browser is kept out of the React components:

| File | Purpose |
|---|---|
| `src/api.ts` | Typed HTTP client for `docs/API.md` (`createApi(fetch)` so tests can fake it). |
| `src/socket.ts` | `GameSocket`: the WebSocket with automatic reconnect (0.5 s growing to 10 s). |
| `src/game/gameStore.ts` | Reducer: how every server message (`docs/WEBSOCKET.md`) changes what the game screen knows. Spots missed updates (`needsSync`) and ignores duplicates. |
| `src/game/hints.ts` | Mirrors a few rules so buttons can be enabled/disabled (can this attack be paid? which creatures can evolve?). The server still validates every move. |
| `src/game/interaction.ts` | What a click means given the current selection (attach, evolve, retreat, promote ...) and which creatures to highlight. |
| `src/game/format.ts` | Turns engine events into the readable game log. |
| `src/deck/editor.ts` | Deck-building helpers; validity comes from the engine's `validateDeck`, the same code the server runs. |
| `src/router.ts` | Hash routing (`#/lobby`, `#/decks/:id`, `#/game`): no server configuration needed. |
| `src/*.tsx`, `pages/`, `components/` | React: contexts (session, catalog, toasts, game connection), pages, and presentational components. |

State flow in a game: `GameSocket` -> `gameReducer` (in `GameProvider`) -> `GamePage`. Moves go the other way:
click -> `interaction.ts` decides an `Action` -> `sendAction` -> server -> `game.update` for both players.

## Feedback: animations and sound

New log entries become short visual effects on the creature slots (`game/effects.ts`: floating -30 / +10 / KO!, a shake on hit)
and sounds (`sound.ts`: tiny synthesized tones, no audio files). Both react only to events that arrive while the screen is open,
never to history replayed after a reload. The 🔊 button in the header mutes and the choice is remembered in the browser.
`prefers-reduced-motion` turns all animation off. To add an effect, extend `fxFromEntries` / `soundsFromEvents` (both are pure and tested).

## Things to know when you extend the game

- **New item/ability effects that need the player to pick a creature**: add the effect handler name to
  `HANDLERS_NEEDING_TARGET` in `src/game/hints.ts`; the UI then asks for a target and sends it as
  `params.target`. (Handlers that need no choice work without any client change.)
- **New attack effects/statuses** show up automatically in the log; add a badge colour in `styles.css` if a new status is introduced.
- **Card art**: cards are text for now (`CardButton`, `CreatureTile` in `components/parts.tsx`).
- The turn timer uses the server's `deadline` (epoch ms) with the browser's clock, so a clock that is
  badly wrong shows a wrong countdown; the server's timing is what counts.

## Tests

`pnpm --filter @cardgame/web test` runs the unit tests (reducer, socket, API client, rule hints, click logic, deck editor, log text).
The components themselves were exercised in a real browser (Chromium) against the real game manager during development:
two players building decks, matchmaking, setup, playing turns, retreat, evolution, items, abilities, promotion after a knockout,
reconnecting, reloading and a phone-sized screen. That harness is not part of the repository.
