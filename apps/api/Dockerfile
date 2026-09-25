# Runner script bundle, served by the API for `curl .../api/install.sh | sh`.
FROM oven/bun:1.3.11-slim AS runner-bundle
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/runner/package.json apps/runner/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production --filter runner
COPY packages/shared packages/shared
COPY apps/runner apps/runner
RUN bun build apps/runner/src/index.ts --target=bun --minify --outfile /runner-dist/hunthub-runner.js

FROM oven/bun:1.3.11-slim
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/runner/package.json apps/runner/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production --filter api

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY --from=runner-bundle /runner-dist /app/runner-dist
WORKDIR /app/apps/api
ENV NODE_ENV=production RUNNER_DIST_DIR=/app/runner-dist
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
	CMD ["bun", "-e", "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# Apply pending migrations, then start.
CMD ["sh", "-c", "bun src/migrate.ts && exec bun src/index.ts"]
