# Circle API server (also serves the exported web build for guest pages / dashboard).
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @circle/mobile build:web
ENV NODE_ENV=production PORT=4100 STATIC_DIR=/app/apps/mobile/dist FILES_DIR=/data/files
EXPOSE 4100
CMD ["pnpm", "--filter", "@circle/server", "start"]
