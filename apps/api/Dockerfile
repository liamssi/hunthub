FROM oven/bun:1.3.11-slim
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production --filter api

COPY packages/shared packages/shared
COPY apps/api apps/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
	CMD ["bun", "-e", "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# Apply pending migrations, then start.
CMD ["sh", "-c", "bun src/migrate.ts && exec bun src/index.ts"]
