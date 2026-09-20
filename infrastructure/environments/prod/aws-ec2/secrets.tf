# Password values are provisioned by an authenticated operator outside Terraform.
# Neither plaintext credentials nor secret versions belong in Terraform state.
resource "aws_secretsmanager_secret" "database" {
  for_each                = toset(["runtime", "migration"])
  name                    = "rogichat/prod/database/${each.key}"
  description             = "production MySQL ${each.key} account; password value managed outside Terraform"
  recovery_window_in_days = 30
  lifecycle {
    prevent_destroy = true
  }
}

# Host-side credential delivery only. Application containers cannot reach IMDS.
# The instance cannot read the migration or RDS-managed administrator password.
resource "aws_iam_role_policy" "database_runtime" {
  name = "read-prod-runtime-database-secret"
  role = aws_iam_role.app.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.database["runtime"].arn]
    }]
  })
}
