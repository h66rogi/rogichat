mock_provider "aws" {
  mock_resource "aws_iam_instance_profile" {
    defaults = { arn = "arn:aws:iam::000000000000:instance-profile/fixture" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::000000000000:role/fixture" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::rogichat-worker-testfixture" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-northeast-2:000000000000:log-group:fixture" }
  }
  mock_resource "aws_lambda_function" {
    defaults = { arn = "arn:aws:lambda:ap-northeast-2:000000000000:function:fixture" }
  }
  mock_resource "aws_cloudwatch_event_rule" {
    defaults = { arn = "arn:aws:events:ap-northeast-2:000000000000:rule/fixture" }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "000000000000" }
  }
}
variables {
  artifact_bucket_name  = "rogichat-worker-testfixture"
  management_private_ip = "10.77.1.20"
  app_private_ip        = "10.76.1.20"
}

run "ledger_disabled_by_default" {
  command = apply
  assert {
    condition     = length(aws_iam_role.ledger_copy) == 0 && length(jsondecode(aws_s3_bucket_policy.artifacts.policy).Statement) == 1
    error_message = "Default must preserve the existing bucket policy and create no roles."
  }
}
run "ledger_environment_boundaries" {
  command = apply
  variables {
    ledger_copy_principals = {
      qa         = { writer = "arn:aws:iam::000000000000:role/qa-copy", verifier = "arn:aws:iam::000000000000:role/qa-audit" }
      production = { writer = "arn:aws:iam::000000000000:role/production-copy", verifier = "arn:aws:iam::000000000000:role/production-audit" }
    }
  }
  override_resource {
    target = aws_iam_role.ledger_copy["qa-writer"]
    values = { arn = "arn:aws:iam::000000000000:role/ledger-copy-qa-writer" }
  }
  override_resource {
    target = aws_iam_role.ledger_copy["qa-verifier"]
    values = { arn = "arn:aws:iam::000000000000:role/ledger-copy-qa-verifier" }
  }
  override_resource {
    target = aws_iam_role.ledger_copy["production-writer"]
    values = { arn = "arn:aws:iam::000000000000:role/ledger-copy-production-writer" }
  }
  override_resource {
    target = aws_iam_role.ledger_copy["production-verifier"]
    values = { arn = "arn:aws:iam::000000000000:role/ledger-copy-production-verifier" }
  }
  assert {
    condition     = length(aws_iam_role.ledger_copy) == 4 && length(local.ledger_copy_denies) == 8
    error_message = "Four independently trusted roles and per-environment deny controls required."
  }
  assert {
    condition     = alltrue([for k, v in aws_iam_role_policy.ledger_copy : jsondecode(v.policy).Statement[0].Resource == "${aws_s3_bucket.artifacts.arn}/deletion-ledger-copy/${local.ledger_copy_roles[k].environment}/*"])
    error_message = "Read scopes must never cross environments."
  }
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.canary.policy).Statement) == 1 && jsondecode(aws_iam_role_policy.canary.policy).Statement[0].Resource == "${aws_s3_bucket.artifacts.arn}/canary/*" && length(jsondecode(aws_vpc_endpoint.s3.policy).Statement) == 1
    error_message = "Existing worker and endpoint permissions must remain unchanged."
  }
  assert {
    condition     = length(aws_s3_bucket_lifecycle_configuration.artifacts.rule) == 1
    error_message = "No ledger expiration rule permitted."
  }
}
run "single_environment_shared_operator" {
  command = apply
  variables {
    ledger_copy_principals = {
      qa = { writer = "arn:aws:iam::000000000000:user/operator", verifier = "arn:aws:iam::000000000000:user/operator" }
    }
  }
  assert {
    condition     = length(aws_iam_role.ledger_copy) == 2 && length(local.ledger_copy_denies) == 4
    error_message = "Each environment must activate independently with separate destination roles."
  }
}
run "reject_account_root" {
  command = plan
  variables {
    ledger_copy_principals = {
      qa = { writer = "arn:aws:iam::000000000000:root", verifier = "arn:aws:iam::000000000000:role/*" }
    }
  }
  expect_failures = [var.ledger_copy_principals]
}
