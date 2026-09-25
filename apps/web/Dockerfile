FROM oven/bun:1 AS build
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

FROM oven/bun:1
WORKDIR /app
COPY --from=build /app/apps/web/build build
COPY --from=build /app/apps/web/package.json .
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["bun", "build/index.js"]
