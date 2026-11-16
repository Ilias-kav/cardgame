# Card game

Online two-player turn-based card game. See `docs/RULES.md` for the rules,
`docs/ARCHITECTURE.md` for the design and `docs/ROADMAP.md` for progress.

## Getting started

Requirements: Node 20+ and pnpm 9+ (`corepack enable` activates pnpm).

```sh
pnpm install
pnpm format        # once, so the CI format check passes
pnpm typecheck
pnpm test
```

## Try the engine in the terminal

```sh
pnpm watch -- --seed 5                   # two bots play a full game, printed turn by turn
pnpm play -- --seed 5 --deck fire --vs water   # you (Player 1) against a bot
```

Decks: `fire`, `water`, `leaf`, `storm`. The seed makes a game reproducible.

## Run the backend

Requires Docker (for PostgreSQL).

```sh
docker compose up -d              # database "cardgame" plus a separate "cardgame_test"
cp packages/server/.env.example packages/server/.env
pnpm db:migrate                   # create the tables (safe to repeat)
pnpm db:seed                      # copy the engine's card catalog into the database
pnpm dev:server                   # http://127.0.0.1:3000/api/health
pnpm --filter @cardgame/server test   # needs the database running
```

The HTTP API is documented in `docs/API.md` and the live-game WebSocket in `docs/WEBSOCKET.md`. If the test database is missing (the volume existed before
`docker/initdb` was added), run `docker compose down -v` once and start again; this wipes local data.

## Run the web client

With the backend running (see above), in a second terminal:

```sh
pnpm dev:web          # http://localhost:5173
```

Open it, create an account, go to **Decks** and add a starter deck, then create a game. To try a whole
game alone, open a second browser window in a private/incognito session, register another user, add a deck and join.
Vite forwards `/api` and `/ws` to the backend (`BACKEND_URL`, default `http://127.0.0.1:3000`), so cookies and
the WebSocket work without any CORS setup. `pnpm build:web` makes a production build in `packages/web/dist`.

## Deploying

`docker-compose.prod.yml` runs PostgreSQL, the app and Caddy (automatic HTTPS) on one server; see `docs/DEPLOY.md`.

## First commit

```sh
git init -b main
git add .
git commit -m "chore: scaffold monorepo and engine setup logic"
```

Then create a remote repository and `git remote add origin <url>` + `git push -u origin main`.
Commit `pnpm-lock.yaml` after the first install (CI uses `--frozen-lockfile`).

## Workflow

- Branch per task: `feat/engine-evolution`, `fix/mulligan-extra-draw`.
- Conventional commit messages: `feat(engine): ...`, `test(engine): ...`, `docs: ...`.
- Keep `main` green: typecheck and tests must pass.
