# syntax=docker/dockerfile:1

# ---------- build stage: install everything, build the web client and the server bundle ----------
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# Install dependencies first (cached unless a package.json or the lockfile changes).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/cli/package.json packages/cli/
RUN pnpm install --frozen-lockfile

COPY packages ./packages
RUN pnpm --filter @cardgame/web build && pnpm --filter @cardgame/server build

# The server bundle inlines our own packages; only third-party dependencies are needed at runtime.
RUN node -e "const p=require('./packages/server/package.json'); \
  const deps=Object.fromEntries(Object.entries(p.dependencies).filter(([n])=>!n.startsWith('@cardgame/'))); \
  require('fs').writeFileSync('/runtime-package.json', JSON.stringify({name:'cardgame-runtime',private:true,type:'module',dependencies:deps}))"

# ---------- runtime stage: small image with just what is needed to run ----------
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /runtime-package.json package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /repo/packages/server/dist ./dist
COPY --from=build /repo/packages/server/migrations ./migrations
COPY --from=build /repo/packages/web/dist ./web

ENV HOST=0.0.0.0 PORT=3000 WEB_DIST=/app/web MIGRATIONS_DIR=/app/migrations
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# On every start: apply new migrations, refresh the card catalog, then run the server.
CMD ["sh", "-c", "node dist/migrate.js && node dist/seed.js && exec node dist/server.js"]
