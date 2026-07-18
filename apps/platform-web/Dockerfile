# Monorepo Dockerfile for @xenode/platform-web.
# Build context MUST be the repo root (see docker-compose.yaml: context: .),
# because npm workspaces + the single root package-lock.json live there.
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat

# ---- deps: install the whole workspace from the root lockfile ----
FROM base AS deps
WORKDIR /repo
# Copy only manifests first for better layer caching.
COPY package.json package-lock.json ./
COPY apps/platform-web/package.json ./apps/platform-web/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
# Skip lifecycle scripts here (source isn't present yet; postinstall runs in builder).
RUN npm ci --include=dev --ignore-scripts

# ---- builder: bring in the source and build the app workspace ----
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Run the app postinstall (copies exifr UMD into public/) now that source exists.
RUN npm run postinstall --workspace @xenode/platform-web
RUN npm run build

# ---- runner ----
FROM base AS runner
WORKDIR /repo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Hoisted dependencies (workspaces install to the root node_modules).
COPY --from=deps --chown=nextjs:nodejs /repo/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /repo/package.json ./package.json

# App runtime artifacts.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform-web/.next ./apps/platform-web/.next
COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform-web/public ./apps/platform-web/public
COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform-web/content ./apps/platform-web/content
COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform-web/package.json ./apps/platform-web/package.json
COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform-web/next.config.ts ./apps/platform-web/next.config.ts
COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform-web/server.mjs ./apps/platform-web/server.mjs
COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform-web/proxy.ts ./apps/platform-web/proxy.ts
COPY --from=builder --chown=nextjs:nodejs /repo/apps/platform-web/instrumentation.ts ./apps/platform-web/instrumentation.ts
USER nextjs
EXPOSE 3000
ENV PORT=3000
WORKDIR /repo/apps/platform-web
CMD ["node", "server.mjs", "--prod"]
