FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/demo/package.json apps/demo/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/telemetry/package.json packages/telemetry/package.json
COPY packages/zero-trust/package.json packages/zero-trust/package.json
COPY packages/shopping-index/package.json packages/shopping-index/package.json
COPY packages/audit/package.json packages/audit/package.json
COPY packages/policy/package.json packages/policy/package.json
COPY services/gift-intelligence/package.json services/gift-intelligence/package.json
COPY services/signal-shield/package.json services/signal-shield/package.json
COPY services/bundle-orchestrator/package.json services/bundle-orchestrator/package.json
COPY services/mcp-gateway/package.json services/mcp-gateway/package.json
COPY services/payments/package.json services/payments/package.json
COPY services/shopify-webhooks/package.json services/shopify-webhooks/package.json
COPY services/telemetry-store/package.json services/telemetry-store/package.json
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
