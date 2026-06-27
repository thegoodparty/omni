#!/bin/sh
set -e

if [ -z "$DB_HOST" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
  echo "One or more required DB environment variables are not set"
  exit 1
fi

if [ -z "$VOTER_DB_HOST" ] || [ -z "$VOTER_DB_PASSWORD" ] || [ -z "$VOTER_DB_USER" ] || [ -z "$VOTER_DB_NAME" ]; then
  echo "One or more required VOTER_DB environment variables are not set"
  exit 1
fi

export DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME?connection_limit=20"
export VOTER_DATASTORE="postgresql://$VOTER_DB_USER:$VOTER_DB_PASSWORD@$VOTER_DB_HOST:5432/$VOTER_DB_NAME"

# Per-PR preview: create the database if it does not already exist.
# Must run before prisma migrate deploy because $DB_NAME may not exist yet on the
# shared Aurora cluster. Connects to the maintenance "postgres" db (which always
# exists) and issues CREATE DATABASE only when pg_database has no matching row.
# CREATE DATABASE cannot run inside a transaction, so this uses a plain client
# connection rather than a transaction block.
# The pg package is a direct (non-dev) dependency, so it is present in --omit=dev
# installs.
if [ "$IS_PREVIEW" = "true" ]; then
  echo "Preview environment: ensuring database '$DB_NAME' exists..."
  # This is the first connection to the cluster, so a cold-starting Aurora
  # Serverless v2 instance can refuse it. Retry like the migration loop below.
  DB_CREATE_RETRIES=0
  DB_CREATE_MAX=30
  while [ $DB_CREATE_RETRIES -lt $DB_CREATE_MAX ]; do
    if node -e "
      const { Client } = require('pg');
      const client = new Client({
        host: process.env.DB_HOST,
        port: 5432,
        database: 'postgres',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: { rejectUnauthorized: false },
      });
      client.connect()
        .then(() => client.query(
          'SELECT 1 FROM pg_database WHERE datname = \$1',
          [process.env.DB_NAME]
        ))
        .then((res) => {
          if (res.rowCount > 0) {
            console.log('Database already exists, skipping create.');
            return;
          }
          return client.query(
            'CREATE DATABASE \"' + process.env.DB_NAME + '\"'
          ).then(() => console.log('Database created.'));
        })
        .then(() => client.end())
        .catch((err) => { console.error(err); process.exit(1); });
    "; then
      break
    else
      DB_CREATE_RETRIES=$((DB_CREATE_RETRIES + 1))
      if [ $DB_CREATE_RETRIES -lt $DB_CREATE_MAX ]; then
        echo "⏳ Aurora not ready yet (attempt $DB_CREATE_RETRIES/$DB_CREATE_MAX). Retrying in 10s..."
        sleep 10
      else
        echo "❌ ERROR: Failed to ensure database after $DB_CREATE_MAX attempts."
        exit 1
      fi
    fi
  done
fi

# Run migrations on startup if DATABASE_URL is set and not a placeholder
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set, can't run migrations"
  exit 1
fi

echo "Waiting for database to be ready..."

# Retry logic for database connection (important for Aurora Serverless v2 which takes time to wake up)
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  echo "Attempting database connection (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)..."

  if npx prisma migrate deploy --schema=prisma/schema 2>&1; then
    echo "✅ Migrations completed successfully."
    break
  else
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
      echo "⏳ Database not ready yet. Retrying in 10s..."
      sleep 10
    else
      echo "❌ ERROR: Failed to connect to database after $MAX_RETRIES attempts."
      exit 1
    fi
  fi
done

if [ -z "$CLERK_SECRET_KEY" ] || [ -z "$CLERK_PUBLISHABLE_KEY" ]; then
  echo "ERROR: CLERK_SECRET_KEY or CLERK_PUBLISHABLE_KEY is not set."
  exit 1
fi

case "$CLERK_SECRET_KEY" in
  sk_live_*)
    if [ "$OTEL_SERVICE_ENVIRONMENT" != "prod" ]; then
      echo "ERROR: Production Clerk key (sk_live_*) used in non-prod environment ($OTEL_SERVICE_ENVIRONMENT)."
      exit 1
    fi
    ;;
  sk_test_*)
    if [ "$OTEL_SERVICE_ENVIRONMENT" = "prod" ]; then
      echo "ERROR: Development Clerk key (sk_test_*) used in prod environment."
      exit 1
    fi
    ;;
  *)
    echo "ERROR: CLERK_SECRET_KEY has unrecognized prefix."
    exit 1
    ;;
esac

if [ "$IS_PREVIEW" = "true" ]; then
  echo "Preview environment detected. Running seed..."
  if npx tsx seed/seed.ts; then
    echo "Seed completed successfully."
  else
    echo "WARNING: Seed failed with exit code $?. Continuing with app startup..."
  fi
fi

# For preview environments, start app in background, sync content, then wait
if [ "$IS_PREVIEW" = "true" ]; then
  echo "Starting application in background for content sync..."
  node -r ./dist/otel.js dist/main &
  APP_PID=$!
  
  echo "Waiting for app to be healthy..."
  for i in $(seq 1 30); do
    if curl -s http://localhost:${PORT:-80}/v1/health > /dev/null 2>&1; then
      echo "App is healthy. Running content sync..."
      if curl -s http://localhost:${PORT:-80}/v1/content/sync > /dev/null 2>&1; then
        echo "Content sync completed."
      else
        echo "WARNING: Content sync failed. Continuing..."
      fi
      break
    fi
    echo "Waiting for app... ($i/30)"
    sleep 2
  done
  
  echo "Waiting on application process..."
  wait $APP_PID
else
  # For non-preview environments, start normally
  exec node -r ./dist/otel.js dist/main
fi

