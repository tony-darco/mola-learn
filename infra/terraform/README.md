# Mola AWS infrastructure (Terraform)

Foundation only: VPC (no NAT), RDS Postgres 16 (pgvector), four S3 buckets
(raw / safe / quarantine / canvas), ECR, task IAM roles, Secrets Manager.
ECS/Fargate, ALB and CI/CD come next.

## Prerequisites
`brew install awscli terraform`, then `aws configure sso` (or `aws configure`)
against a **non-root** IAM identity.

## First-time setup
```bash
cd infra/terraform/bootstrap && terraform init && terraform apply   # state bucket
cd .. && terraform init -backend-config="bucket=mola-tfstate-<account-id>"
terraform plan -out tf.plan && terraform apply tf.plan
```

## After apply
1. Enable extensions once (from a host inside the VPC, or temporary SSM/bastion):
   `CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;`
2. Put app secrets: `aws secretsmanager put-secret-value --secret-id mola-dev/app --secret-string '{"AUTH_SECRET":"...","MOLA_ENCRYPTION_KEY":"..."}'`
3. Add the deployed web origin to `web_origins` for upload CORS.

## Cost (us-east-1, approx.)
RDS t4g.micro free for 12 months on a new account, then ~$23/mo. No NAT, no
ALB yet. S3/ECR negligible.
