# Disabled by default. Private bindings supply approved exact role or user ARNs.
# No credential issuance, compute, endpoint or lifecycle changes.
variable "ledger_copy_principals" {
  type    = map(object({ writer = string, verifier = string }))
  default = {}
  validation {
    condition = alltrue([for env in keys(var.ledger_copy_principals) : contains(["qa", "production"], env)]) && alltrue(flatten([
      for v in values(var.ledger_copy_principals) : [for arn in [v.writer, v.verifier] : can(regex("^arn:aws:iam::[0-9]{12}:(role|user)/[A-Za-z0-9_+=,.@/-]+$", arn))]
    ]))
    error_message = "Only qa/production and exact IAM role or user principals are accepted; no account root or wildcard."
  }
}
locals {
  ledger_copy_roles = merge([
    for env, principals in var.ledger_copy_principals : {
      for kind, principal in principals : "${env}-${kind}" => {
        environment = env
        kind        = kind
        principal   = principal
        prefix      = "deletion-ledger-copy/${env}/"
      }
    }
  ]...)
  ledger_copy_denies = flatten([
    for env in keys(var.ledger_copy_principals) : [
      {
        Sid       = "LedgerConditional${env}"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.artifacts.arn}/deletion-ledger-copy/${env}/*"
        # Missing or different header denied, including multipart initiation.
        Condition = { StringNotEquals = { "s3:if-none-match" = "*" } }
      },
      {
        Sid       = "LedgerNoCopy${env}"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.artifacts.arn}/deletion-ledger-copy/${env}/*"
        Condition = { Null = { "s3:x-amz-copy-source" = "false" } }
      },
      {
        Sid       = "LedgerNoDelete${env}"
        Effect    = "Deny"
        Principal = "*"
        Action    = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource  = "${aws_s3_bucket.artifacts.arn}/deletion-ledger-copy/${env}/*"
      },
      {
        Sid       = "LedgerOnlyWriter${env}"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.artifacts.arn}/deletion-ledger-copy/${env}/*"
        Condition = { ArnNotEquals = { "aws:PrincipalArn" = aws_iam_role.ledger_copy["${env}-writer"].arn } }
      }
    ]
  ])
}
resource "aws_iam_role" "ledger_copy" {
  for_each             = local.ledger_copy_roles
  name                 = "ledger-copy-${each.key}"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { AWS = each.value.principal } }]
  })
}
resource "aws_iam_role_policy" "ledger_copy" {
  for_each = local.ledger_copy_roles
  name     = "environment-scoped-ledger-copy"
  role     = aws_iam_role.ledger_copy[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.artifacts.arn}/${each.value.prefix}*"
      }
      ], each.value.kind == "writer" ? [
      {
        Effect    = "Allow"
        Action    = ["s3:PutObject"]
        Resource  = "${aws_s3_bucket.artifacts.arn}/${each.value.prefix}*"
        Condition = { StringEquals = { "s3:if-none-match" = "*" }, Null = { "s3:x-amz-copy-source" = "true" } }
      }
      ] : [
      {
        Effect    = "Allow"
        Action    = ["s3:ListBucket", "s3:ListBucketVersions"]
        Resource  = aws_s3_bucket.artifacts.arn
        Condition = { StringLike = { "s3:prefix" = "${each.value.prefix}*" } }
      }
    ])
  })
}
