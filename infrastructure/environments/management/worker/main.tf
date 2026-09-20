# This is an isolation canary, not a credentialed Terraform worker. Only a
# trusted operator can launch the template. Management receives no new policy.
locals { name = "rogichat-worker-canary" }

resource "aws_vpc" "worker" {
  cidr_block           = "10.78.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}
resource "aws_subnet" "worker" {
  vpc_id                  = aws_vpc.worker.id
  cidr_block              = "10.78.1.0/24"
  availability_zone       = "ap-northeast-2a"
  map_public_ip_on_launch = false
}
resource "aws_route_table" "worker" {
  vpc_id = aws_vpc.worker.id
  # Local and this root's S3 gateway endpoint only. No IGW, NAT or peering.
}
resource "aws_route_table_association" "worker" {
  subnet_id      = aws_subnet.worker.id
  route_table_id = aws_route_table.worker.id
}
resource "aws_security_group" "worker" {
  name        = local.name
  description = "No ingress; HTTPS to policy-restricted S3 gateway endpoint only"
  vpc_id      = aws_vpc.worker.id
  ingress     = []
}
resource "aws_vpc_security_group_egress_rule" "s3" {
  security_group_id = aws_security_group.worker.id
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_s3_bucket" "artifacts" {
  bucket        = var.artifact_bucket_name
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  depends_on = [aws_s3_bucket_versioning.artifacts]
  bucket     = aws_s3_bucket.artifacts.id
  rule {
    id     = "short-lived-diagnostics"
    status = "Enabled"
    filter { prefix = "canary/" }
    expiration { days = 7 }
    noncurrent_version_expiration { noncurrent_days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyPlaintext"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.artifacts.arn, "${aws_s3_bucket.artifacts.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}
resource "aws_iam_role" "canary" {
  name = local.name
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy" "canary" {
  name = "write-diagnostics-only"
  role = aws_iam_role.canary.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${aws_s3_bucket.artifacts.arn}/canary/*"
    }]
  })
}
resource "aws_iam_instance_profile" "canary" {
  name = local.name
  role = aws_iam_role.canary.name
}
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.worker.id
  service_name      = "com.amazonaws.ap-northeast-2.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.worker.id]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = "*"
      Action    = ["s3:PutObject"]
      Resource  = "${aws_s3_bucket.artifacts.arn}/canary/*"
      Condition = { ArnEquals = { "aws:PrincipalArn" = aws_iam_role.canary.arn } }
    }]
  })
}

data "aws_ami" "worker" {
  owners = ["137112412989"] # Amazon's AL2023 standard image, not community/minimal.
  filter {
    name   = "image-id"
    values = ["ami-03137ee2d0c5af1fe"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}
resource "aws_launch_template" "canary" {
  name                                 = local.name
  image_id                             = data.aws_ami.worker.id
  instance_type                        = "t3a.small"
  instance_initiated_shutdown_behavior = "terminate"
  update_default_version               = false
  disable_api_termination              = false
  ebs_optimized                        = true
  iam_instance_profile { arn = aws_iam_instance_profile.canary.arn }
  network_interfaces {
    device_index                = 0
    subnet_id                   = aws_subnet.worker.id
    security_groups             = [aws_security_group.worker.id]
    associate_public_ip_address = false
    delete_on_termination       = true
  }
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    http_protocol_ipv6          = "disabled"
    instance_metadata_tags      = "disabled"
  }
  credit_specification { cpu_credits = "standard" }
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_type           = "gp3"
      volume_size           = 8
      encrypted             = true
      delete_on_termination = true
    }
  }
  user_data = base64encode(templatefile("${path.module}/bootstrap.sh.tftpl", {
    canary_base64 = filebase64("${path.module}/../../../atlantis/worker/canary.py")
    config_base64 = base64encode(jsonencode({
      bucket                = var.artifact_bucket_name
      management_private_ip = var.management_private_ip
      app_private_ip        = var.app_private_ip
    }))
  }))
  tag_specifications {
    resource_type = "instance"
    tags          = { Name = local.name, Component = "worker-canary", Project = "rogichat", Environment = "management" }
  }
  tag_specifications {
    resource_type = "volume"
    tags          = { Name = local.name, Component = "worker-canary", Project = "rogichat", Environment = "management" }
  }
}

output "launch_template_id" {
  value     = aws_launch_template.canary.id
  sensitive = true
}
output "launch_template_version" {
  value = aws_launch_template.canary.latest_version
}
