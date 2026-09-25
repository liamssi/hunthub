FROM oven/bun:1
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --filter api

COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000
# Apply pending migrations, then start.
CMD ["sh", "-c", "bun src/migrate.ts && exec bun src/index.ts"]
