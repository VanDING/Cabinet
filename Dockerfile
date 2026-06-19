# Stage 1: Build
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/types/package.json packages/types/
COPY packages/events/package.json packages/events/
COPY packages/storage/package.json packages/storage/
COPY packages/gateway/package.json packages/gateway/
COPY packages/agent/package.json packages/agent/
COPY packages/memory/package.json packages/memory/
COPY packages/decision/package.json packages/decision/
COPY packages/secretary/package.json packages/secretary/
COPY packages/workflow/package.json packages/workflow/
COPY packages/harness/package.json packages/harness/
COPY packages/ui/package.json packages/ui/
COPY packages/cli/package.json packages/cli/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Stage 2: Runtime
FROM node:24-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json /app/tsconfig.base.json ./
COPY --from=builder /app/packages/types/package.json /app/packages/types/
COPY --from=builder /app/packages/events/package.json /app/packages/events/
COPY --from=builder /app/packages/storage/package.json /app/packages/storage/
COPY --from=builder /app/packages/gateway/package.json /app/packages/gateway/
COPY --from=builder /app/packages/agent/package.json /app/packages/agent/
COPY --from=builder /app/packages/memory/package.json /app/packages/memory/
COPY --from=builder /app/packages/decision/package.json /app/packages/decision/
COPY --from=builder /app/packages/secretary/package.json /app/packages/secretary/
COPY --from=builder /app/packages/workflow/package.json /app/packages/workflow/
COPY --from=builder /app/packages/harness/package.json /app/packages/harness/
COPY --from=builder /app/packages/ui/package.json /app/packages/ui/
COPY --from=builder /app/packages/cli/package.json /app/packages/cli/
COPY --from=builder /app/apps/server/package.json /app/apps/server/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/packages /app/packages
COPY --from=builder /app/apps/server/dist /app/apps/server/dist
EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
USER node
CMD ["node", "apps/server/dist/main.js"]
