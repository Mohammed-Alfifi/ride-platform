# Build from the repository root: docker build -f apps/admin/Dockerfile -t ride-admin .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile --filter @ride/admin...
COPY apps/admin apps/admin
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @ride/admin build

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3001 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
USER app
EXPOSE 3001
CMD ["node", "apps/admin/server.js"]
