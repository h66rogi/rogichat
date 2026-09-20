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

run "canary_cannot_execute_terraform_or_reach_existing_services" {
  command = apply # Mock only: evaluate generated resource ARNs in IAM policies.
  assert {
    condition     = length(aws_security_group.worker.ingress) == 0 && aws_vpc_security_group_egress_rule.s3.from_port == 443 && aws_vpc_security_group_egress_rule.s3.to_port == 443 && aws_vpc_security_group_egress_rule.s3.cidr_ipv4 == null && !aws_subnet.worker.map_public_ip_on_launch
    error_message = "Worker must have no inbound/public IP and only the S3 prefix-list HTTPS egress."
  }
  assert {
    condition     = jsondecode(aws_iam_role_policy.canary.policy).Statement[0].Action == ["s3:PutObject"] && length(jsondecode(aws_iam_role_policy.canary.policy).Statement) == 1
    error_message = "Canary must have no Terraform, IAM mutation, state, Secrets Manager or SSM permissions."
  }
  assert {
    condition     = aws_launch_template.canary.instance_initiated_shutdown_behavior == "terminate" && aws_launch_template.canary.metadata_options[0].http_tokens == "required" && aws_launch_template.canary.metadata_options[0].http_put_response_hop_limit == 1 && aws_launch_template.canary.block_device_mappings[0].ebs[0].encrypted && aws_launch_template.canary.block_device_mappings[0].ebs[0].delete_on_termination && aws_launch_template.canary.key_name == null
    error_message = "Worker must use IMDSv2, encrypted ephemeral storage, automatic termination and no SSH key."
  }
  assert {
    condition     = aws_launch_template.canary.instance_type == "t3a.small" && aws_launch_template.canary.block_device_mappings[0].ebs[0].volume_size == 8 && aws_launch_template.canary.credit_specification[0].cpu_credits == "standard"
    error_message = "Do not silently increase canary capacity or enable CPU credit overage."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.artifacts.block_public_acls && aws_s3_bucket_public_access_block.artifacts.block_public_policy && aws_s3_bucket_public_access_block.artifacts.ignore_public_acls && aws_s3_bucket_public_access_block.artifacts.restrict_public_buckets && !aws_s3_bucket.artifacts.force_destroy && aws_s3_bucket_ownership_controls.artifacts.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "Diagnostic artifacts must stay private and owner-enforced."
  }
}
