# Deploying

One small server runs everything with Docker: PostgreSQL, the app (API + WebSocket + the built web client)
and Caddy, which handles HTTPS certificates automatically.

```
internet --443--> Caddy --> app (Node, port 3000, not published) --> PostgreSQL (not published)
```

> These Docker files were written but could not be run where they were developed (no Docker there).
> The server bundle and web build were verified; the images themselves were not. Expect to fix a small
> thing on the first `docker compose up`, and look at the troubleshooting section below.

## What you need

- A Linux server (1 CPU / 1 GB RAM is enough to start) with Docker and the Compose plugin installed.
- A domain name, with a DNS `A` (and `AAAA` for IPv6) record pointing at the server.
- Ports **80** and **443** (TCP, and 443/UDP for HTTP/3) open in the firewall. Nothing else needs to be public.

## First deployment

```sh
git clone <your repository> cardgame && cd cardgame
cp .env.production.example .env.production
nano .env.production         # set DOMAIN and a long random POSTGRES_PASSWORD (openssl rand -base64 32)
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Then:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml ps        # all three "running"/"healthy"
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f app
```

Open `https://<your domain>`. The first visit may take a few seconds while Caddy obtains the certificate.
Create an account, add a starter deck under **Decks**, and you can play. (Shortcut for typing the long command:
`export COMPOSE_FILE=docker-compose.prod.yml COMPOSE_ENV_FILES=.env.production`, then just `docker compose ...`.)

**Trying it on your own computer first:** set `DOMAIN=localhost`. Caddy then uses its own local certificate,
so the browser warns once unless you run `docker compose exec caddy caddy trust`.

## What happens on every start of the app container

1. `node dist/migrate.js` applies any new database migrations (safe to repeat).
2. `node dist/seed.js` copies the current card catalog into the database (safe to repeat).
3. The server starts, and **rebuilds every game that was running** from the database.

## Updating to a new version

```sh
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Players in a running game are disconnected for a few seconds while the app restarts; the game itself is restored
from the database and they reconnect automatically (they have 60 seconds before a disconnect counts as a forfeit).
Still, update when few people are playing. If you changed the game **rules** in the engine, games that were running
under the old rules may not replay correctly and are then marked abandoned.

## Backups

Everything that matters is in the `pgdata` volume. A daily dump is the simplest backup:

```sh
# crontab -e   (run daily at 03:00; keep the files somewhere off this server too)
0 3 * * * cd /path/to/cardgame && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db pg_dump -U cardgame cardgame | gzip > /backups/cardgame-$(date +\%F).sql.gz
```

Restore into an empty database:

```sh
gunzip -c /backups/cardgame-2026-01-01.sql.gz | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db psql -U cardgame cardgame
```

Also keep `.env.production` somewhere safe: without the same `POSTGRES_PASSWORD` the database volume cannot be reused.

## Settings (in `.env.production`)

| Variable | Meaning |
|---|---|
| `DOMAIN` | Public host name; also the only browser origin allowed to open the WebSocket. |
| `POSTGRES_PASSWORD` | Database password (the database is not reachable from outside Docker). |
| `TURN_TIMEOUT_SECONDS` | Time a player has to finish a turn before losing (default 120). |
| `DISCONNECT_GRACE_SECONDS` | Time a disconnected player has to come back (default 60). |

More options (session length, rate limits, waiting-game lifetime) are listed in `packages/server/.env.example`
and can be added to the `app` service's `environment:` in `docker-compose.prod.yml`.

## Security checklist

- [ ] `.env.production` is not in git (it is in `.gitignore`) and has a strong `POSTGRES_PASSWORD`.
- [ ] Firewall allows only SSH (ideally key-only), 80 and 443.
- [ ] The server gets automatic security updates (`unattended-upgrades` on Debian/Ubuntu).
- [ ] You can restore a backup (try it once on another machine).
- [ ] `TRUST_PROXY=true` is set **only** because the app sits behind Caddy. If you ever expose the app directly,
      remove it: otherwise clients could fake their IP address and avoid the login rate limit.

The proxy adds HTTPS with HSTS, a Content-Security-Policy, and other security headers (`deploy/Caddyfile`).
Session cookies are `HttpOnly`, `SameSite=Lax` and `Secure` in production.

## Limits to know about

- **One app instance only.** Running games live in that process's memory (they are saved to the database and
  recovered after a restart, but two instances would not see each other's games). One small server handles hundreds of
  simultaneous games; scaling beyond that needs routing each game to one instance (see `docs/ARCHITECTURE.md`).
- The database is a single container on the same machine. For anything beyond a hobby project, consider a managed
  PostgreSQL service: point `DATABASE_URL` at it and remove the `db` service.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Browser says the certificate is invalid / Caddy logs show ACME errors | DNS does not point at this server yet, or ports 80/443 are blocked. Check `docker compose logs caddy`. |
| The site loads but the game never connects (red dot) | `ALLOWED_ORIGINS` must be exactly `https://<DOMAIN>`: use the same value you open in the browser (no extra `www.`). |
| "Invalid configuration" in the app log | A required variable is missing; the message lists which. |
| App restarts in a loop | `docker compose logs app`: usually the database is not reachable or migrations failed. |
| Cannot log in (cookie not kept) | The site is being opened over plain `http://`; production cookies need HTTPS. |
| Everyone shares one login rate limit | `TRUST_PROXY` is not `true` while using the proxy; the app then sees only the proxy's address. |
