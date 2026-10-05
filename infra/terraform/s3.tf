# Mirrors infra/localstack-init/00-buckets.sh. Scanner is the only principal
# allowed to move objects between raw -> safe/quarantine (see iam.tf).
data "aws_caller_identity" "current" {}

locals {
  buckets = {
    raw        = "mola-${var.environment}-raw-${data.aws_caller_identity.current.account_id}"
    safe       = "mola-${var.environment}-safe-${data.aws_caller_identity.current.account_id}"
    quarantine = "mola-${var.environment}-quarantine-${data.aws_caller_identity.current.account_id}"
    canvas     = "mola-${var.environment}-canvas-${data.aws_caller_identity.current.account_id}"
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets
  bucket   = each.value
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Canvas images are served via plain <img src>, so that bucket alone allows a
# public bucket policy. Every other bucket is fully locked down.
resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = each.key != "canvas"
  restrict_public_buckets = each.key != "canvas"
}

resource "aws_s3_bucket_cors_configuration" "raw" {
  bucket = aws_s3_bucket.this["raw"].id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "POST"]
    allowed_origins = var.web_origins
    expose_headers  = ["ETag"]
  }
}

resource "aws_s3_bucket_cors_configuration" "canvas" {
  bucket = aws_s3_bucket.this["canvas"].id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT", "GET"]
    allowed_origins = var.web_origins
    expose_headers  = ["ETag"]
  }
}

resource "aws_s3_bucket_policy" "canvas_public_read" {
  bucket     = aws_s3_bucket.this["canvas"].id
  depends_on = [aws_s3_bucket_public_access_block.this]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadCanvasImages"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.this["canvas"].arn}/*"
    }]
  })
}

# Raw uploads are transient (scanner deletes after promotion); this is a
# backstop for abandoned/failed uploads.
resource "aws_s3_bucket_lifecycle_configuration" "raw" {
  bucket = aws_s3_bucket.this["raw"].id
  rule {
    id     = "expire-raw"
    status = "Enabled"
    filter {}
    expiration {
      days = 7
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "quarantine" {
  bucket = aws_s3_bucket.this["quarantine"].id
  rule {
    id     = "expire-quarantine"
    status = "Enabled"
    filter {}
    expiration {
      days = 90
    }
  }
}
