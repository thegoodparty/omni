# Use the public.ecr.aws BuildKit image
FROM public.ecr.aws/vend/moby/buildkit:buildx-stable-1 AS buildkit

# Stage 1: Install dependencies and build application
FROM public.ecr.aws/docker/library/node:22.23.0-alpine AS builder

RUN apk add --no-cache \
    libc6-compat \
    openssl \
    python3 \
    make \
    g++ \
    gcc \
    postgresql-dev \
    postgresql-client \
    linux-headers \
    musl-dev \
    bash \
    git \
    curl \
    autoconf \
    automake \
    libtool \
    pkgconfig

# Set Python path and other build variables
ENV PYTHON=/usr/bin/python3
ENV PYTHONPATH=/usr/lib/python3.10/site-packages
ENV NODE_OPTIONS="--max-old-space-size=4096"
# Prevent Puppeteer from downloading Chrome
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/dev/null

WORKDIR /app

# Optionally bust the cache to force a rebuild of the following steps
ARG CACHEBUST

# Install dependencies
COPY package.json package-lock.json ./
COPY packages/election-api/package.json ./packages/election-api/package.json
# election-api imports @goodparty_org/nest-common; nest build typechecks against
# it, so the prebuilt workspace package must be present for module resolution.
COPY packages/nest-common/package.json ./packages/nest-common/package.json
COPY packages/nest-common/dist ./packages/nest-common/dist
RUN npm cache clean --force && \
    npm ci --build-from-source --ignore-scripts --workspace election-api

# Copy application source files, prisma files, and seed data
COPY packages/election-api ./packages/election-api

# Set the docker build args into environment variables on runner.
ARG STAGE
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

WORKDIR /app/packages/election-api

# Generate Prisma client
RUN npm run generate

# Build the application (output in /dist)
RUN npm run build

# Stage 2: Create a minimal runtime image
FROM public.ecr.aws/docker/library/node:22.23.0-alpine

RUN apk add --no-cache \
    libc6-compat \
    openssl

WORKDIR /app

# Copy package files for production dependencies
COPY package.json package-lock.json ./
COPY packages/election-api/package.json ./packages/election-api/package.json
# The compiled dist also imports @goodparty_org/nest-common, so its prebuilt
# workspace package must be present for npm to link it into node_modules.
COPY packages/nest-common/package.json ./packages/nest-common/package.json
COPY packages/nest-common/dist ./packages/nest-common/dist
# Install only production dependencies with --ignore-scripts
RUN npm ci --omit=dev --ignore-scripts --workspace election-api

WORKDIR /app/packages/election-api

# Copy only necessary files to the runtime image
COPY --from=builder /app/packages/election-api/dist ./dist
COPY --from=builder /app/packages/election-api/prisma ./prisma
COPY --from=builder /app/packages/election-api/module-alias.js ./
# The Prisma client is generated to a custom output dir (src/generated/prisma)
# which holds the client JS, its bundled runtime, and the query-engine binary.
# `nest build` only transpiles .ts, so it is not emitted into dist; copy it to
# the path the compiled output resolves at runtime (dist/src/generated/prisma).
COPY --from=builder /app/packages/election-api/src/generated/prisma ./dist/src/generated/prisma

# Copy the entrypoint script and ensure it's executable
COPY --from=builder /app/packages/election-api/deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Set the NODE_ENV to production
ENV NODE_ENV=production

# Use the entrypoint script as the container's entrypoint
ENTRYPOINT [ "./entrypoint.sh" ]
