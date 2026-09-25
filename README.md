# hunthub

Agent-native bug bounty hunt management platform. See [description.md](description.md) for the vision.

## Stack

Bun + TypeScript monorepo:

- `apps/api` — Hono API server, PostgreSQL via Drizzle ORM
- `apps/web` — SvelteKit UI (talks only to the API)

## Development

```bash
cp .env.example .env
bun install
bun run db:up      # start Postgres in Docker
bun run dev        # API on :3000, web on :5173
```

## Full stack in Docker

```bash
docker compose up -d --build   # API on :3000, web on :3001
```

## Database

Schema lives in `apps/api/src/db/schema.ts`. From `apps/api`:

```bash
bun run db:generate   # create a migration from schema changes
bun run db:migrate    # apply migrations
```
