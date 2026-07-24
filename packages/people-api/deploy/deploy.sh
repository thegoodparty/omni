#!/bin/sh
set -e

env="$1"
if [ -z "$env" ]; then
  echo "Usage: deploy.sh <env>"
  exit 1
fi

if [ -z "$IMAGE_URI" ]; then
  echo "Error: IMAGE_URI is not set"
  exit 1
fi

PULUMI_CONFIG_PASSPHRASE=$(aws ssm get-parameter \
  --name "pulumi-state-config-passphrase" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text)

if [ -z "$PULUMI_CONFIG_PASSPHRASE" ]; then
  echo "Error: Failed to pull pulumi state config passphrase from SSM"
  exit 1
fi

export PULUMI_CONFIG_PASSPHRASE

# The running service resolves its DB URL from this SSM parameter at runtime and
# crashes on startup if it is missing — which otherwise surfaces only as an
# opaque ECS steady-state failure. Fail the deploy here with a clear message
# instead. The parameter is created out-of-band (not managed by Pulumi, to keep
# the DB secret out of state): see deploy/index.ts.
DB_URL_PARAM="people-db-connection-string-$env"
if ! aws ssm get-parameter --name "$DB_URL_PARAM" --query "Parameter.Name" --output text >/dev/null 2>&1; then
  echo "Error: SSM parameter '$DB_URL_PARAM' not found. Create it before deploying:"
  echo "  aws ssm put-parameter --name $DB_URL_PARAM --type SecureString --value '<postgres-connection-string>'"
  exit 1
fi

pulumi login s3://goodparty-iac-state
pulumi stack select "organization/people-api/people-api-$env" --create
pulumi config set aws:region "$AWS_REGION"
pulumi config set environment "$env"
pulumi config set imageUri "$IMAGE_URI"
pulumi config set --path aws:defaultTags.tags.Environment "$env"
pulumi config set --path aws:defaultTags.tags.Project people-api

if [ "$CI" = "true" ]; then
  pulumi up --diff --yes
else
  pulumi preview --diff
fi
