FROM node:22.23.0-alpine3.23

RUN apk add --no-cache \
  libc6-compat \
  openssl \
  curl

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/gp-api/package.json ./packages/gp-api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/contracts/dist ./packages/contracts/dist
RUN npm ci --omit=dev --legacy-peer-deps --workspace gp-api

WORKDIR /app/packages/gp-api

COPY packages/gp-api/dist ./dist
COPY packages/gp-api/prisma ./prisma

# Copy seed and src for tsx runtime seeding (preview environments only)
COPY packages/gp-api/seed ./seed
COPY packages/gp-api/src ./src
COPY packages/gp-api/scripts ./scripts
COPY packages/gp-api/tsconfig.json ./

ENV NODE_ENV=production

COPY packages/gp-api/deploy/docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

# Deployed commit SHA, surfaced at runtime via GET /v1/version so deploys can be
# gated on "the new build is actually serving". Placed last to avoid busting the
# layer cache for earlier (content-addressed) layers.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

ENTRYPOINT ["./docker-entrypoint.sh"]
