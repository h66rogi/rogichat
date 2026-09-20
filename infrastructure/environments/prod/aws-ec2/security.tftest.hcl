variables {
  aws_account_id = "000000000000"
}
mock_provider "aws" {}
override_resource {
  target          = aws_security_group.app
  override_during = plan
  values          = { id = "sg-0123456789abcdef0" }
}
run "private_database_and_no_public_ssh" {
  command = plan
  assert {
    condition     = alltrue([for rule in aws_vpc_security_group_ingress_rule.web : contains([80, 443], rule.from_port)]) && length(aws_vpc_security_group_ingress_rule.web) == 2
    error_message = "Only HTTP/HTTPS may be exposed publicly."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.mysql.referenced_security_group_id == aws_security_group.app.id && aws_vpc_security_group_ingress_rule.mysql.from_port == 3306 && !aws_rds_cluster_instance.writer.publicly_accessible
    error_message = "The DB must accept MySQL only from the app security group."
  }
  assert {
    condition     = aws_rds_cluster.prod.storage_encrypted && aws_rds_cluster.prod.manage_master_user_password && aws_rds_cluster.prod.deletion_protection && !aws_rds_cluster.prod.skip_final_snapshot && aws_rds_cluster.prod.backup_retention_period == 14
    error_message = "DB encryption, managed password, backup and deletion protection are required."
  }
  assert {
    condition     = aws_rds_cluster.prod.engine == "aurora-mysql" && aws_rds_cluster.prod.engine_mode == "provisioned" && aws_rds_cluster_instance.writer.instance_class == "db.r8g.large" && aws_rds_cluster.prod.storage_type == "aurora"
    error_message = "Require reviewed provisioned Aurora Standard, not Serverless or a different engine."
  }
  assert {
    condition     = aws_instance.app.metadata_options[0].http_tokens == "required" && aws_instance.app.metadata_options[0].http_put_response_hop_limit == 1 && aws_instance.app.root_block_device[0].encrypted && aws_instance.app.disable_api_termination && aws_instance.app.credit_specification[0].cpu_credits == "standard"
    error_message = "Require IMDSv2, container metadata isolation, encrypted disk and predictable CPU charging."
  }
  assert {
    condition     = startswith(aws_instance.app.user_data, "#!/bin/bash\n") && !strcontains(aws_instance.app.user_data, "docker compose up -d") && !strcontains(aws_instance.app.user_data, "ufw allow from")
    error_message = "EC2 bootstrap must use Bash and defer Caddy until DNS cutover, with no public SSH rule."
  }
  assert {
    condition     = length([for p in aws_rds_cluster_parameter_group.prod.parameter : p if p.name == "require_secure_transport" && p.value == "ON"]) == 1
    error_message = "Database transport encryption must be mandatory."
  }
}
run "reject_unreviewed_database_cost_change" {
  command = plan
  variables {
    db_instance_class = "db.t4g.medium"
  }
  expect_failures = [var.db_instance_class]
}

run "production_isolation" {
  command = plan
  assert {
    condition     = aws_vpc.prod.cidr_block == "10.79.0.0/16" && aws_rds_cluster.prod.database_name == "rogichatprod" && alltrue([for secret in aws_secretsmanager_secret.database : startswith(secret.name, "rogichat/prod/database/")])
    error_message = "Production network, database and secrets must be distinct from QA."
  }
  assert {
    condition     = !aws_instance.app.root_block_device[0].delete_on_termination && strcontains(aws_instance.app.user_data, filebase64("${path.module}/../runtime/Caddyfile.bootstrap")) && strcontains(aws_instance.app.user_data, filebase64("${path.module}/../runtime/compose.bootstrap.yaml")) && strcontains(aws_instance.app.user_data, "--accept-dns=false --accept-routes=false --ssh=false")
    error_message = "Retain the production disk, exclude QA edge configuration and preserve tailnet DNS isolation."
  }
}

override_resource {
  target          = aws_secretsmanager_secret.database["runtime"]
  override_during = plan
  values          = { arn = "arn:aws:secretsmanager:ap-northeast-2:000000000000:secret:rogichat/prod/database/runtime-fixture" }
}
run "host_cannot_read_qa_admin_or_migration_passwords" {
  command = plan
  assert {
    condition     = length(jsondecode(aws_iam_role_policy.database_runtime.policy).Statement) == 1 && jsondecode(aws_iam_role_policy.database_runtime.policy).Statement[0].Resource == [aws_secretsmanager_secret.database["runtime"].arn] && jsondecode(aws_iam_role_policy.database_runtime.policy).Statement[0].Action == ["secretsmanager:GetSecretValue"]
    error_message = "The application role must read exactly its production runtime credential and nothing else."
  }
}
