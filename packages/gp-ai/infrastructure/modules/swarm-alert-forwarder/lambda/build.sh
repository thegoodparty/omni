#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔨 Building swarm alert forwarder package..."

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed"
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found"
    exit 1
fi

# The registry occasionally resets a connection mid-install (ENG-11433: an
# ECONNRESET here failed a whole release train and blocked dev and prod). npm's
# own retries are short and per-request, so wrap the install in whole-command
# attempts as well.
install_in() {
    local dir="$1"
    shift
    local attempt=1
    until (cd "$dir" && npm ci --no-audit --no-fund "$@" \
        --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=30000); do
        if [ "$attempt" -ge 3 ]; then
            echo "❌ Error: npm ci failed after $attempt attempts"
            exit 1
        fi
        echo "⚠️  npm ci failed (attempt $attempt), retrying in $((attempt * 10))s..."
        sleep $((attempt * 10))
        attempt=$((attempt + 1))
    done
}

echo "📦 Installing build dependencies..."
install_in "$SCRIPT_DIR"

echo "🏗️  Compiling TypeScript..."
npm run build

# Runs here rather than in a workflow of its own: every place that builds this
# zip is about to deploy it, so a failing test fails the same step. The full
# `npm ci` above already installed vitest.
echo "🧪 Running tests..."
npm test

# The zip carries production dependencies only. @aws-sdk/client-secrets-manager
# is not in the Lambda runtime's bundle, so it must ship; vitest and typescript
# are build tools and would triple the package for no runtime benefit.
echo "📦 Installing runtime dependencies..."
rm -rf .runtime
mkdir -p .runtime
cp package.json package-lock.json .runtime/
install_in "$SCRIPT_DIR/.runtime" --omit=dev
cp -r .runtime/node_modules dist/
rm -rf .runtime

# --omit=dev leaves the empty scope directories of the pruned dev packages
# behind. They are harmless but noise in the package.
find dist/node_modules -mindepth 1 -type d -empty -delete

echo "📦 Packaging..."
rm -f swarm-alert-forwarder.zip
(cd dist && zip -qr ../swarm-alert-forwarder.zip .)

echo "✅ Lambda package built successfully: swarm-alert-forwarder.zip"
echo "📊 Package size: $(du -h swarm-alert-forwarder.zip | cut -f1)"
