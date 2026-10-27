FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DATA_DIR=/app/var
RUN groupadd --system --gid 1001 molbrief && useradd --system --uid 1001 --gid molbrief molbrief && mkdir -p /app/var && chown molbrief:molbrief /app/var
COPY --from=builder --chown=molbrief:molbrief /app/.next/standalone ./
COPY --from=builder --chown=molbrief:molbrief /app/.next/static ./.next/static
COPY --from=builder --chown=molbrief:molbrief /app/public ./public
COPY --from=builder --chown=molbrief:molbrief /app/drizzle ./drizzle
COPY --from=builder --chown=molbrief:molbrief /app/scripts ./scripts
COPY --from=builder --chown=molbrief:molbrief /app/lib/storage-core.mjs ./lib/storage-core.mjs
COPY --from=builder --chown=molbrief:molbrief /app/data/content-export.json ./data/content-export.json
USER molbrief
EXPOSE 3000
CMD ["sh", "-c", "node scripts/check-config.mjs && node scripts/migrate.mjs && exec node server.js"]
