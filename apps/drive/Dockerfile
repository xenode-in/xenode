# Monorepo Dockerfile for @xenode/drive.
# Build context MUST be the repo root (see docker-compose.yaml: context: .),
# because npm workspaces + the single root package-lock.json live there.
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat

# ---- deps: install the whole workspace from the root lockfile ----
FROM base AS deps
WORKDIR /repo
# Copy only manifests first for better layer caching.
COPY package.json package-lock.json ./
COPY apps/drive/package.json ./apps/drive/
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
RUN npm run postinstall --workspace @xenode/drive
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
COPY --from=builder --chown=nextjs:nodejs /repo/apps/drive/.next ./apps/drive/.next
COPY --from=builder --chown=nextjs:nodejs /repo/apps/drive/public ./apps/drive/public
COPY --from=builder --chown=nextjs:nodejs /repo/apps/drive/content ./apps/drive/content
COPY --from=builder --chown=nextjs:nodejs /repo/apps/drive/package.json ./apps/drive/package.json
COPY --from=builder --chown=nextjs:nodejs /repo/apps/drive/next.config.ts ./apps/drive/next.config.ts
COPY --from=builder --chown=nextjs:nodejs /repo/apps/drive/server.mjs ./apps/drive/server.mjs
COPY --from=builder --chown=nextjs:nodejs /repo/apps/drive/proxy.ts ./apps/drive/proxy.ts
COPY --from=builder --chown=nextjs:nodejs /repo/apps/drive/instrumentation.ts ./apps/drive/instrumentation.ts
USER nextjs
EXPOSE 3000
ENV PORT=3000
WORKDIR /repo/apps/drive
CMD ["node", "server.mjs", "--prod"]
