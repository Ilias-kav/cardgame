# Roadmap

Check items off as they are finished. Anyone can pick up an unchecked item.

## Phase 0: Scaffolding
- [x] pnpm workspace, TypeScript, Vitest, Prettier, `.gitattributes`
- [x] CI workflow (typecheck, test, format check)
- [x] `docs/RULES.md`, `docs/ARCHITECTURE.md`
- [ ] ESLint (typescript-eslint) setup
- [ ] First commit, push to remote, enable branch protection on `main`

## Phase 1: Engine types and setup
- [x] Card, state, action, event types
- [x] Deck validation
- [x] Seeded RNG, shuffle, coin flip
- [x] Game creation: coin flip, prizes, hands, mulligans with extra draws
- [x] Setup actions: optional extra draw, place starting creatures
- [x] Tests for the above

## Phase 2: Turn flow
- [x] Start-of-turn draw (deck-out loss)
- [x] PLAY_BASIC, ATTACH_POWER (1/turn), PLAY_ITEM, EVOLVE, RETREAT, USE_ABILITY
- [x] Cost payment (typed + neutral + double neutral), attack resolution
- [x] Weakness/resistance, END_TURN, current-player validation

## Phase 3: Knockouts, statuses, win conditions
- [x] Knockout: discard stack, take prize, PROMOTE pending decision
- [x] Poison, sleep, paralysis, confusion (+ clear on evolve/retreat)
- [x] Between-turn processing
- [x] Win conditions, simultaneous cases, sudden-death rematch

## Phase 4: Engine hardening
- [x] Rule-by-rule unit tests for phases 1-3 (90 tests)
- [x] Random-play fuzz test (bots play full games; invariants checked after every action)
- [x] CLI to play/watch a game (`packages/cli`)
- [x] Placeholder card set (29 cards, 4 starter decks) in `engine/src/sets/starter.ts`

## Phase 5: Backend foundation
- [x] PostgreSQL schema + migrations
- [x] Auth (register/login/logout, sessions)
- [x] REST: card catalog, deck CRUD with engine validation

## Phase 6: Game server
- [x] WebSocket auth via session cookie
- [x] Create/join game, lobby, one-active-game-per-player constraint
- [x] GameRoom: action queue, redacted per-player views, event broadcast
- [x] Persistence, recovery, reconnect, turn timer/forfeit

## Phase 7: Web client
- [x] Login/register, catalog, deck builder
- [x] Lobby
- [x] Battlefield and action UI, pending-decision prompts, action log

## Phase 8: Polish and deployment
- [x] Animations and sounds (floating damage numbers, hit shake, knockout flash, synthesized sound effects with a mute switch), game-over screen
- [x] Docker image, production compose stack, automatic HTTPS (Caddy), deployment guide (`docs/DEPLOY.md`)
