mock_provider "aws" {}
run "management_has_no_terraform_or_application_credentials" {
  command = plan
  assert {
    condition     = length(aws_security_group.management.ingress) == 0 && aws_iam_role_policy_attachment.ssm.policy_arn == "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
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
