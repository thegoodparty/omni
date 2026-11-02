#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔨 Building Lambda trigger package..."

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed"
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found"
    exit 1
fi

# The registry occasionally resets a connection mid-install (ENG-11433: an
# ECONNRESET here failed a whole release train and blocked dev and prod).
# npm's own retries are short and per-request, so wrap the install in a few
# whole-command attempts as well.
echo "📦 Installing dependencies..."
attempt=1
until npm ci --production=false --no-audit --no-fund \
    --fetch-retries=5 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=30000; do
    if [ "$attempt" -ge 3 ]; then
        echo "❌ Error: npm ci failed after $attempt attempts"
        exit 1
    fi
    echo "⚠️  npm ci failed (attempt $attempt), retrying in $((attempt * 10))s..."
    sleep $((attempt * 10))
    attempt=$((attempt + 1))
done

echo "🏗️  Compiling TypeScript..."
npm run build

echo "✅ Lambda package built successfully: lambda-trigger.zip"
echo "📊 Package size: $(du -h lambda-trigger.zip | cut -f1)"
