# App-level secrets (AUTH_SECRET, MOLA_ENCRYPTION_KEY, Google OAuth). Values are
# set out-of-band so they never land in Terraform state:
#   aws secretsmanager put-secret-value --secret-id mola-dev/app --secret-string '{...}'
resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name}/app"
  description             = "AUTH_SECRET, MOLA_ENCRYPTION_KEY, GOOGLE_CLIENT_ID/SECRET"
  recovery_window_in_days = 7
}
