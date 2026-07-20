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

# Install dependencies
COPY package.json package-lock.json ./
# people-api/tsconfig.json extends ../../tsconfig.base.json; the in-image
# `npm run build` needs it present or tsc reverts to defaults (no skipLibCheck
# / esModuleInterop) and fails typechecking node_modules type declarations.
COPY tsconfig.base.json ./
COPY packages/people-api/package.json ./packages/people-api/package.json
# people-api imports @goodparty_org/contracts; nest build typechecks against it,
# so the prebuilt workspace package must be present for module resolution.
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/contracts/dist ./packages/contracts/dist
# people-api also imports @goodparty_org/nest-common; nest build typechecks
# against it, so the prebuilt workspace package must be present too.
COPY packages/nest-common/package.json ./packages/nest-common/package.json
COPY packages/nest-common/dist ./packages/nest-common/dist
RUN npm cache clean --force && \
    npm ci --build-from-source --ignore-scripts --workspace people-api

# Copy application source files, including nest-cli.json. The Nest CLI config is
# required so `nest build` uses the swc builder and keeps the flat dist/ layout.
COPY packages/people-api ./packages/people-api

# Set the docker build args into environment variables on runner.
ARG STAGE
# `prisma generate` reads the datasource url env var but never connects, so a
# placeholder is sufficient at build time. The running service does not use this
# — it resolves the real URL from SSM at runtime (see DatabaseUrlProvider).
ARG LOCAL_DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV LOCAL_DATABASE_URL=$LOCAL_DATABASE_URL

WORKDIR /app/packages/people-api

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
COPY packages/people-api/package.json ./packages/people-api/package.json
# The compiled dist imports @goodparty_org/contracts, so the prebuilt workspace
# package must be present for npm to link it into node_modules — otherwise the
# container crashes on boot with "Cannot find module '@goodparty_org/contracts'".
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/contracts/dist ./packages/contracts/dist
# The compiled dist also imports @goodparty_org/nest-common, so its prebuilt
# workspace package must be present for npm to link it into node_modules.
COPY packages/nest-common/package.json ./packages/nest-common/package.json
COPY packages/nest-common/dist ./packages/nest-common/dist
# Install only production dependencies with --ignore-scripts
RUN npm ci --omit=dev --ignore-scripts --workspace people-api

WORKDIR /app/packages/people-api

# Copy only necessary files to the runtime image
COPY --from=builder /app/packages/people-api/dist ./dist
# Prisma client now generates to a per-package output dir (src/generated/prisma)
# instead of node_modules/.prisma. Copy it to where the flat compiled dist code
# resolves it, including the query-engine binary generated for the runtime image.
COPY --from=builder /app/packages/people-api/src/generated/prisma ./dist/generated/prisma
COPY --from=builder /app/packages/people-api/prisma ./prisma
COPY --from=builder /app/packages/people-api/module-alias.js ./

# Copy the entrypoint script and ensure it's executable
COPY --from=builder /app/packages/people-api/deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Set the NODE_ENV to production
ENV NODE_ENV=production
# Use the entrypoint script as the container's entrypoint
ENTRYPOINT [ "./entrypoint.sh" ]
