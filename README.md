# hunthub

Agent-native bug bounty hunt management platform. See [description.md](description.md) for the vision.

## Stack

Bun + TypeScript monorepo:

- `apps/api` — Hono API server, PostgreSQL via Drizzle ORM
- `apps/web` — SvelteKit UI (shadcn-svelte + Tailwind); talks only to the API
- `apps/runner` — the HuntHub runner, a small service on each machine that connects out to the hub
- `packages/shared` — code shared by the apps (roles and permissions, runner protocol, machine types)

Auth is Better Auth (email + password, admin-created accounts, roles `admin` / `member`).
One origin serves everything: `/api/*` (HTTP and WebSocket) goes to the API, the rest to the web app. Caddy does
this in Docker; Vite's dev proxy does it in development.

## Development

```bash
cp .env.example .env
bun install
bun run db:up      # start Postgres in Docker
bun run dev        # API on :3000, web on :5173 (open http://localhost:5173)
```

Fill in `POSTGRES_PASSWORD` (and `DATABASE_URL`) and `BETTER_AUTH_SECRET` in `.env` (see the comments there). Then apply migrations and create the first admin (it prompts for the password):

```bash
cd apps/api
bun run db:migrate
bun run create-admin you@example.com "Your Name"
```

Tests:

```bash
cd apps/api && bun run test      # integration tests (use the dev database, clean up after themselves)
cd apps/runner && bun test       # runner unit tests
```

## Machines and the runner

Add a machine from **Machines → Add machine**: it shows a one-line command to run on the machine, as the user that
should run agents. The installer downloads the runner (a small script run by Bun; it installs Bun if missing),
registers the machine and starts it as a systemd user service. Run the same command without a token to update an
installed runner:

```bash
curl -fsSL <hub-url>/api/install.sh | sh -s -- <join-token>   # install and register
curl -fsSL <hub-url>/api/install.sh | sh                        # update an installed runner
```

The hub serves the runner bundle from `apps/runner/dist` in development (`cd apps/runner && bun run bundle`); the
API Docker image builds its own. On the machine: `hunthub-runner status`, `journalctl --user -u hunthub-runner`, and
`hunthub-runner uninstall`.

Machines on your Tailscale network can reach a development hub if you expose it on the tailnet only:

```bash
sudo tailscale serve --bg --http=5173 http://localhost:5173
```

## Full stack in Docker

```bash
docker compose up -d --build   # Caddy on :3001 → web + API (migrations run on start)
docker compose exec -it api bun src/cli/create-admin.ts you@example.com "Your Name"
```

Published ports are bound to `127.0.0.1`. For a real deployment, set `SITE_ADDRESS` to a domain (Caddy then gets
HTTPS automatically), publish ports 80/443, set `PUBLIC_URL` to the `https://` address, and remove the `postgres`
port mapping.

## Database

Schema lives in `apps/api/src/db/schema.ts`. From `apps/api`:

```bash
bun run db:generate   # create a migration from schema changes
bun run db:migrate    # apply migrations
```
