# The case scout's bucket. The scout runs in gp-api
# (packages/gp-api/src/caseScout), which reads and writes this bucket with its
# own task role's grants (packages/gp-api/deploy/index.ts).

# --- Bucket ------------------------------------------------------------
#
# "One bucket, whose create-only-if-missing writes replace a database table"
# (TDD, "New infra"). Terraform owns its existence and settings; the scout's
# own code writes claims, manifests and scores create-only (If-None-Match),
# see gp-api's caseScoutBucket.service.ts. No lifecycle rule deletes anything
# here: a scout bucket holds its own history (processed session ids, the
# ledger, each night's held handoff) that later runs depend on reading back.

resource "aws_s3_bucket" "scout" {
  bucket = "case-scout-${var.environment}"

  lifecycle {
    # A bucket holding the scout's own append-only ledger and its marker
    # must never be destroyed by an unrelated apply mistake (e.g. a renamed
    # variable that Terraform reads as "replace this resource").
    prevent_destroy = true
  }

  tags = {
    Environment = var.environment
    Service     = "case-scout"
  }
}

resource "aws_s3_bucket_versioning" "scout" {
  bucket = aws_s3_bucket.scout.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "scout" {
  bucket = aws_s3_bucket.scout.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "scout" {
  bucket = aws_s3_bucket.scout.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
