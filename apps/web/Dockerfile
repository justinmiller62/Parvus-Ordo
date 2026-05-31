# syntax=docker/dockerfile:1
# Build context is the REPO ROOT (needs the pnpm workspace + packages/*).
#   docker build -f apps/web/Dockerfile -t parvaordo-web .

# ---- build: install workspace deps + emit the standalone server ----
FROM node:22 AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @parvaordo/web build

# ---- runner: lean image, only the standalone output ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Next standalone (monorepo layout): apps/web/server.js + traced node_modules at root.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
