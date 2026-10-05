# One image recipe for every Next.js product. Build context: the repo root.
#   docker build -f deploy/app.Dockerfile --build-arg APP=drive -t xenode-drive .
# APP is the directory under apps/ (accounts | drive | photos).
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
RUN apk add --no-cache libc6-compat
WORKDIR /repo

# npm ci needs every workspace manifest named by the root lockfile.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY apps/accounts/package.json apps/accounts/
COPY apps/drive/package.json apps/drive/
COPY apps/photos/package.json apps/photos/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/crypto-core/package.json packages/crypto-core/
COPY packages/crypto-react/package.json packages/crypto-react/
COPY packages/database/package.json packages/database/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/identity-core/package.json packages/identity-core/
COPY packages/key-handoff/package.json packages/key-handoff/
COPY packages/media-processing/package.json packages/media-processing/
COPY packages/photos/package.json packages/photos/
COPY packages/realtime/package.json packages/realtime/
COPY packages/spaces/package.json packages/spaces/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/ui/package.json packages/ui/
COPY packages/upload-engine/package.json packages/upload-engine/

FROM manifests AS build
# Both installs share one locked npm cache instead of downloading in parallel.
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --ignore-scripts
COPY . .
ARG APP
# `next build` inlines NEXT_PUBLIC_* values and freezes next.config headers
# (which read the product origins and, for Photos, the R2 endpoints), so these
# are build args. None is a secret.
ARG ACCOUNTS_ORIGIN
ARG DRIVE_ORIGIN
ARG PHOTOS_ORIGIN
ARG S3_ENDPOINT
ARG S3_US_ENDPOINT
ARG S3_EU_ENDPOINT
ARG NEXT_PUBLIC_ACCOUNTS_ORIGIN
ARG NEXT_PUBLIC_DRIVE_ORIGIN
ARG NEXT_PUBLIC_PHOTOS_ORIGIN
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_REALTIME_ORIGIN
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN
ARG NEXT_PUBLIC_ONLYOFFICE_EDITOR_ORIGIN
ARG NEXT_PUBLIC_ONLYOFFICE_EDITOR_BASE_URL
ARG NEXT_PUBLIC_ONLYOFFICE_ARTIFACT_VERSION
ENV NEXT_TELEMETRY_DISABLED=1
# An empty build arg would defeat the code's fallbacks, so unset it. Office
# artifacts belong to the editor origin, never to a product origin.
RUN for name in $(env | sed -n 's/^\([A-Z0-9_]*\)=$/\1/p'); do unset "$name"; done \
  && rm -rf apps/${APP}/public/internal-editors \
  && npm run postinstall --if-present --workspace apps/${APP} \
  && npm run build --workspace apps/${APP} \
  && rm -rf apps/${APP}/node_modules packages/*/node_modules apps/${APP}/.next/cache

# Production dependencies of this product only.
FROM manifests AS prod-deps
ARG APP
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm ci --omit=dev --ignore-scripts --prefer-offline --workspace apps/${APP} \
  && mkdir -p apps/${APP}/node_modules

FROM base AS runner
ARG APP
# Docker sets HOSTNAME to the container id; listen on every interface.
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=prod-deps --chown=nextjs:nodejs /repo/package.json ./package.json
COPY --from=prod-deps --chown=nextjs:nodejs /repo/node_modules ./node_modules
# Workspace packages are linked from node_modules and shipped as source; the
# second copy adds their production-only nested dependencies.
COPY --from=build --chown=nextjs:nodejs /repo/packages ./packages
COPY --from=prod-deps --chown=nextjs:nodejs /repo/packages ./packages
COPY --from=build --chown=nextjs:nodejs /repo/apps/${APP} ./apps/${APP}
COPY --from=prod-deps --chown=nextjs:nodejs /repo/apps/${APP}/node_modules ./apps/${APP}/node_modules
USER nextjs
WORKDIR /repo/apps/${APP}
CMD ["npm", "run", "start"]
