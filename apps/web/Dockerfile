FROM oven/bun:1.3.11-slim AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --filter web

COPY packages/shared packages/shared
COPY apps/web apps/web
WORKDIR /app/apps/web
RUN bun run build

FROM oven/bun:1.3.11-slim
WORKDIR /app
# The build is self-contained: adapter-node bundles all devDependencies.
COPY --from=build /app/apps/web/build build
COPY --from=build /app/apps/web/package.json .
ENV NODE_ENV=production PORT=3000
USER bun
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
	CMD ["bun", "-e", "fetch('http://localhost:3000/login').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["bun", "build/index.js"]
