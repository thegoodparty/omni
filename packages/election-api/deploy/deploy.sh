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

# Fetch Pulumi passphrase from SSM
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

pulumi login s3://goodparty-iac-state
pulumi stack select "organization/election-api/election-api-$env" --create
pulumi config set aws:region "$AWS_REGION"
pulumi config set environment "$env"
pulumi config set imageUri "$IMAGE_URI"
pulumi config set --path aws:defaultTags.tags.Environment "$env"
pulumi config set --path aws:defaultTags.tags.Project election-api

if [ "$CI" = "true" ]; then
  # A runner killed mid-`pulumi up` leaves its S3 state lock behind, and every
  # later deploy of the stack then fails in seconds until someone clears it by
  # hand — this stranded election-api dev deploys for four days (2026-07-31).
  # CI serializes every Pulumi operation on a stack through the deploy job's
  # concurrency group, so a lock still held at this point is always an orphan.
  # Locally it may be a live operation, hence CI-only.
  pulumi cancel --yes || true
  pulumi up --diff --yes
else
  pulumi preview --diff
fi