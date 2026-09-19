locals {
  name = "rogichat-qa"
}

# Dedicated QA network; neither a shared VPC nor legacy infrastructure is mutated.
resource "aws_vpc" "qa" {
  cidr_block           = "10.76.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}
resource "aws_internet_gateway" "qa" {
  vpc_id = aws_vpc.qa.id
}
resource "aws_subnet" "app" {
  vpc_id                  = aws_vpc.qa.id
  cidr_block              = "10.76.1.0/24"
  availability_zone       = "ap-northeast-2a"
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-app" }
}
resource "aws_subnet" "db" {
  for_each                = { a = "10.76.11.0/24", c = "10.76.12.0/24" }
  vpc_id                  = aws_vpc.qa.id
  cidr_block              = each.value
  availability_zone       = "ap-northeast-2${each.key}"
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-db-${each.key}" }
}
resource "aws_route_table" "app" {
  vpc_id = aws_vpc.qa.id
}
resource "aws_route" "internet" {
  route_table_id         = aws_route_table.app.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.qa.id
}
resource "aws_route_table_association" "app" {
  subnet_id      = aws_subnet.app.id
  route_table_id = aws_route_table.app.id
}
resource "aws_route_table" "db" {
  vpc_id = aws_vpc.qa.id
  # Local VPC routing only. No internet gateway, NAT gateway or public DB route.
}
resource "aws_route_table_association" "db" {
  for_each       = aws_subnet.db
  subnet_id      = each.value.id
  route_table_id = aws_route_table.db.id
}
resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "Public HTTPS and ACME; SSH is only over the outbound-established tailnet"
  vpc_id      = aws_vpc.qa.id
}
resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each          = toset(["80", "443"])
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
}
resource "aws_vpc_security_group_egress_rule" "app" {
  security_group_id = aws_security_group.app.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
resource "aws_security_group" "db" {
  name        = "${local.name}-database"
  description = "MySQL from the QA app security group only"
  vpc_id      = aws_vpc.qa.id
}
resource "aws_vpc_security_group_ingress_rule" "mysql" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 3306
  to_port                      = 3306
}

resource "aws_iam_role" "app" {
  name = "${local.name}-ssm"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_instance_profile" "app" {
  name = "${local.name}-ssm"
  role = aws_iam_role.app.name
}
resource "aws_key_pair" "operator" {
  key_name   = "${local.name}-operator"
  public_key = trimspace(file(var.ssh_public_key_path))
}
data "aws_ami" "ubuntu" {
  owners = ["099720109477"]
  filter {
    name   = "image-id"
    values = [var.ami_id]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}
resource "aws_instance" "app" {
  depends_on                  = [aws_route.internet, aws_route_table_association.app, aws_iam_role_policy_attachment.ssm, aws_vpc_security_group_egress_rule.app]
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.app.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  associate_public_ip_address = true
  key_name                    = aws_key_pair.operator.key_name
  iam_instance_profile        = aws_iam_instance_profile.app.name
  disable_api_termination     = true
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  credit_specification {
    cpu_credits = "standard"
  }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 80
    encrypted             = true
    delete_on_termination = true
  }
  # A launch-time public address permits apt/SSM before EIP association.
  # Caddy is staged but not started until approved DNS cutover, avoiding ACME failures.
  user_data = join("\n", [
    "#!/bin/bash",
    "set -euo pipefail",
    "snap list amazon-ssm-agent >/dev/null 2>&1 || snap install amazon-ssm-agent --classic",
    "systemctl enable --now snap.amazon-ssm-agent.amazon-ssm-agent.service",
    templatefile("${path.module}/../../../runtime/bootstrap.sh.tftpl", {
      bootstrap_ssh_cidrs = []
      compose_base64      = filebase64("${path.module}/../../../runtime/compose.bootstrap.yaml")
      caddyfile_base64    = filebase64("${path.module}/../../../runtime/Caddyfile.bootstrap")
      start_caddy         = false
    })
  ])
  tags = { Name = "${local.name}-app" }
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [user_data]
  }
}
resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = "${local.name}-app" }
}
resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

resource "aws_db_subnet_group" "qa" {
  name       = local.name
  subnet_ids = [for subnet in aws_subnet.db : subnet.id]
}
resource "aws_rds_cluster_parameter_group" "qa" {
  name   = "${local.name}-mysql8"
  family = "aurora-mysql8.0"
  parameter {
    name  = "require_secure_transport"
    value = "ON"
  }
}
resource "aws_rds_cluster" "qa" {
  cluster_identifier              = local.name
  engine                          = "aurora-mysql"
  engine_mode                     = "provisioned"
  engine_version                  = var.db_engine_version
  database_name                   = "rogichatqa"
  master_username                 = "rogichat_admin"
  manage_master_user_password     = true
  db_subnet_group_name            = aws_db_subnet_group.qa.name
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.qa.name
  vpc_security_group_ids          = [aws_security_group.db.id]
  storage_encrypted               = true
  storage_type                    = "aurora"
  backup_retention_period         = 7
  preferred_backup_window         = "18:00-19:00"
  preferred_maintenance_window    = "sun:19:00-sun:20:00"
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.name}-final-retirement"
  copy_tags_to_snapshot           = true
  apply_immediately               = false
  lifecycle {
    prevent_destroy = true
  }
}
resource "aws_rds_cluster_instance" "writer" {
  identifier                 = "${local.name}-writer"
  cluster_identifier         = aws_rds_cluster.qa.id
  instance_class             = var.db_instance_class
  engine                     = aws_rds_cluster.qa.engine
  engine_version             = aws_rds_cluster.qa.engine_version
  db_subnet_group_name       = aws_db_subnet_group.qa.name
  publicly_accessible        = false
  auto_minor_version_upgrade = false
  copy_tags_to_snapshot      = true
  promotion_tier             = 0
  lifecycle {
    prevent_destroy = true
  }
}

output "app_instance_id" {
  value     = aws_instance.app.id
  sensitive = true
}
output "static_ip" {
  value     = aws_eip.app.public_ip
  sensitive = true
}
output "database_endpoint" {
  value     = aws_rds_cluster.qa.endpoint
  sensitive = true
}
output "database_admin_secret_arn" {
  value     = aws_rds_cluster.qa.master_user_secret[0].secret_arn
  sensitive = true
}
