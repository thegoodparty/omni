FROM node:22.23.0-alpine3.23

RUN apk add --no-cache \
  libc6-compat \
  openssl \
  curl \
  libcap \
  ffmpeg
# ffmpeg transcodes robocall recordings (webm/mp4) to mp3 in-process before the
# CallHub media upload, which accepts only mp3/wav/ogg (AudioTranscodeService).

# Run as a non-root user (defense-in-depth hardening). The stock node image
# ships an unprivileged `node` user (uid 1000). The app binds container port 80,
# which is privileged, so grant the node binary CAP_NET_BIND_SERVICE (a targeted
# capability, not root) so it can still bind < 1024 after dropping privileges.
# Done here rather than at the end so it lands in an always-cached layer instead
# of re-copying the 47MB node binary into a fresh layer on every build.
RUN setcap 'cap_net_bind_service=+ep' "$(command -v node)"

WORKDIR /app/packages/gp-api

# Only manifests go in before `npm ci`, so the ~600MB dependency layer is keyed
# on the lockfile alone. The workspace dists used to be copied in here too, and
# contracts changes on roughly one main commit in ten, so most builds threw the
# layer away and reinstalled it.
COPY package.json package-lock.json /app/
COPY packages/gp-api/package.json /app/packages/gp-api/package.json
COPY packages/contracts/package.json /app/packages/contracts/package.json
COPY packages/nest-common/package.json /app/packages/nest-common/package.json
RUN cd /app && npm ci --omit=dev --legacy-peer-deps --workspace gp-api

# Everything below is a --link copy or metadata, never a RUN. That lets BuildKit
# stack these layers on a cached dependency layer without downloading it, and
# the push skips it because ECR already holds that blob.
# gp-api imports @goodparty_org/nest-common; the prebuilt workspace packages
# must be present so the links npm created resolve at runtime.
COPY --link packages/contracts/dist /app/packages/contracts/dist
COPY --link packages/nest-common/dist /app/packages/nest-common/dist

COPY --link packages/gp-api/dist ./dist
COPY --link packages/gp-api/prisma ./prisma

# Copy seed and src for tsx runtime seeding (preview environments only)
COPY --link packages/gp-api/seed ./seed
COPY --link packages/gp-api/src ./src
COPY --link packages/gp-api/scripts ./scripts
COPY --link packages/gp-api/tsconfig.json ./

ENV NODE_ENV=production

COPY --link --chmod=755 packages/gp-api/deploy/docker-entrypoint.sh ./

# Deployed commit SHA, surfaced at runtime via GET /v1/version so deploys can be
# gated on "the new build is actually serving". Placed last to avoid busting the
# layer cache for earlier (content-addressed) layers.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

USER node

ENTRYPOINT ["./docker-entrypoint.sh"]
