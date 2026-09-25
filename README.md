# hunthub

Agent-native bug bounty hunt management platform. See [description.md](description.md) for the vision.

## Stack

Bun + TypeScript monorepo:

- `apps/api` — Hono API server, PostgreSQL via Drizzle ORM
- `apps/web` — SvelteKit UI (shadcn-svelte + Tailwind), talks only to the API; proxies `/api/*` to it
- `packages/shared` — code shared by both apps (roles and permissions)

Auth is Better Auth (email + password, admin-created accounts, roles `admin` / `member`).

## Development

```bash
cp .env.example .env
bun install
bun run db:up      # start Postgres in Docker
bun run dev        # API on :3000, web on :5173
```

Set `BETTER_AUTH_SECRET` in `.env` (`openssl rand -base64 32`). Then apply migrations and create the first admin:

```bash
cd apps/api
bun run db:migrate
bun run create-admin you@example.com "Your Name" 'a-strong-password'
```

## Full stack in Docker

```bash
docker compose up -d --build   # API on :3000, web on :3001 (migrations run on start)
docker compose exec api bun src/cli/create-admin.ts you@example.com "Your Name" 'a-strong-password'
```

## Database

Schema lives in `apps/api/src/db/schema.ts`. From `apps/api`:

```bash
bun run db:generate   # create a migration from schema changes
bun run db:migrate    # apply migrations
```
