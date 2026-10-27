FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
# Copy the full workspace so pnpm can discover every workspace package
# that apps/api depends on (directly and transitively). Copying only a
# subset caused ERR_PNPM_WORKSPACE_PKG_NOT_FOUND on Render.
COPY . .
RUN pnpm install --no-frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @gift-signal/api build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
