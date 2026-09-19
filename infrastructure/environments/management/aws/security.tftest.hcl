mock_provider "aws" {}
run "management_has_no_terraform_or_application_credentials" {
  command = plan
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.webhook) == 0 && aws_iam_role_policy_attachment.ssm.policy_arn == "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
    error_message = "Management bootstrap must have no public ingress and only the SSM agent role."
  }
  assert {
    condition     = aws_instance.management.metadata_options[0].http_tokens == "required" && aws_instance.management.metadata_options[0].http_put_response_hop_limit == 1 && aws_instance.management.root_block_device[0].encrypted && aws_instance.management.disable_api_termination
    error_message = "Require metadata and disk protection."
  }
  assert {
    condition     = aws_instance.management.instance_type == "t3a.small" && aws_instance.management.credit_specification[0].cpu_credits == "standard" && aws_instance.management.root_block_device[0].volume_size == 30
    error_message = "Unreviewed management capacity changes are forbidden."
  }
}

run "webhook_exposes_only_https_and_acme_http" {
  command = plan
  variables { enable_webhook_ingress = true }
  assert {
    condition = length(aws_vpc_security_group_ingress_rule.webhook) == 2 && alltrue([
      for rule in aws_vpc_security_group_ingress_rule.webhook :
      contains([80, 443], rule.from_port) && rule.to_port == rule.from_port && rule.ip_protocol == "tcp"
    ])
    error_message = "Only TCP 80 and 443 may be added; never expose SSH, Atlantis, or gateway ports."
  }
}
