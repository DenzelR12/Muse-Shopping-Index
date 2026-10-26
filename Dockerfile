FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY services/gift-intelligence/package.json services/gift-intelligence/package.json
COPY services/signal-shield/package.json services/signal-shield/package.json
RUN pnpm install --no-frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @gift-signal/api build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
EXPOSE 3000
CMD ["node","dist/index.js"]
