data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Web: mint pre-signed PUTs into raw, read clean docs, manage canvas images.
# It can never read raw or touch quarantine.
resource "aws_iam_role" "web_task" {
  name               = "${local.name}-web-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "web_task" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.this["raw"].arn}/*"]
  }
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.this["safe"].arn}/*"]
  }
  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.this["canvas"].arn}/*"]
  }
}

resource "aws_iam_role_policy" "web_task" {
  role   = aws_iam_role.web_task.id
  policy = data.aws_iam_policy_document.web_task.json
}

# Ingest worker = the scanner: the only principal that reads raw and writes
# safe/quarantine.
resource "aws_iam_role" "ingest_task" {
  name               = "${local.name}-ingest-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "ingest_task" {
  statement {
    actions   = ["s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.this["raw"].arn}/*"]
  }
  statement {
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.this["safe"].arn}/*"]
  }
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.this["quarantine"].arn}/*"]
  }
}

resource "aws_iam_role_policy" "ingest_task" {
  role   = aws_iam_role.ingest_task.id
  policy = data.aws_iam_policy_document.ingest_task.json
}
