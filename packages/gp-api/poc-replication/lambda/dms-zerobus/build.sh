#!/usr/bin/env bash
# Builds the path C Lambda bundles into dist/ (gitignored), which index.ts
# zips. Run after `npm ci` at the repo root and before `pulumi up` with
# enableDms=true. The AWS SDK comes from the Lambda Node.js 22 runtime, and the
# Zerobus SDK is installed as its linux-x64 native build next to the consumer.
set -euo pipefail

cd "$(dirname "$0")"
ESBUILD="$(git rev-parse --show-toplevel)/node_modules/.bin/esbuild"
ZEROBUS_SDK_VERSION=1.4.0

rm -rf dist
mkdir -p dist/consumer dist/canary

"$ESBUILD" consumer.ts --bundle --platform=node --target=node22 --format=cjs \
  --outfile=dist/consumer/index.js \
  --external:@aws-sdk/* --external:@databricks/zerobus-ingest-sdk
"$ESBUILD" canary.ts --bundle --platform=node --target=node22 --format=cjs \
  --outfile=dist/canary/index.js \
  --external:@aws-sdk/* --external:pg-native

cd dist/consumer
echo '{ "private": true }' > package.json
npm install --omit=dev --os=linux --cpu=x64 --libc=glibc --no-audit --no-fund \
  --no-package-lock "@databricks/zerobus-ingest-sdk@$ZEROBUS_SDK_VERSION"
test -f node_modules/@databricks/zerobus-ingest-sdk-linux-x64-gnu/package.json
echo "Built $(pwd)/.. (consumer with zerobus-ingest-sdk $ZEROBUS_SDK_VERSION linux-x64-gnu, canary)"
