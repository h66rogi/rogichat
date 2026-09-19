# Management foundation only. No Terraform apply role, GitHub credentials,
# webhook ingress, application network routes or worker are granted here.
locals { name = "rogichat-management" }
resource "aws_vpc" "management" {
  cidr_block           = "10.77.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}
resource "aws_internet_gateway" "management" { vpc_id = aws_vpc.management.id }
resource "aws_subnet" "management" {
  vpc_id                  = aws_vpc.management.id
  cidr_block              = "10.77.1.0/24"
  availability_zone       = "ap-northeast-2a"
  map_public_ip_on_launch = false
}
resource "aws_route_table" "management" { vpc_id = aws_vpc.management.id }
resource "aws_route" "internet" {
  route_table_id         = aws_route_table.management.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.management.id
}
resource "aws_route_table_association" "management" {
  subnet_id      = aws_subnet.management.id
  route_table_id = aws_route_table.management.id
}
resource "aws_security_group" "management" {
  name        = local.name
  description = "No public ingress; SSM bootstrap and outbound-established Tailscale"
  vpc_id      = aws_vpc.management.id
}
resource "aws_vpc_security_group_egress_rule" "management" {
  security_group_id = aws_security_group.management.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
resource "aws_iam_role" "management" {
  name = "${local.name}-ssm"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.management.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_instance_profile" "management" {
  name = "${local.name}-ssm"
  role = aws_iam_role.management.name
}
resource "aws_key_pair" "operator" {
  key_name   = "${local.name}-operator"
  public_key = trimspace(file(var.ssh_public_key_path))
}
data "aws_ami" "ubuntu" {
  owners = ["099720109477"]
  filter {
    name   = "image-id"
    values = ["ami-086a43496cb46286c"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}
resource "aws_instance" "management" {
  depends_on                  = [aws_route.internet, aws_route_table_association.management, aws_iam_role_policy_attachment.ssm, aws_vpc_security_group_egress_rule.management]
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = "t3a.small"
  subnet_id                   = aws_subnet.management.id
  vpc_security_group_ids      = [aws_security_group.management.id]
  associate_public_ip_address = true
  key_name                    = aws_key_pair.operator.key_name
  iam_instance_profile        = aws_iam_instance_profile.management.name
  disable_api_termination     = true
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  credit_specification { cpu_credits = "standard" }
  root_block_device {
    volume_type           = "gp3"
    volume_size           = 30
    encrypted             = true
    delete_on_termination = true
  }
  user_data = file("${path.module}/bootstrap.sh")
  tags      = { Name = local.name }
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [user_data]
  }
}
resource "aws_eip" "management" {
  domain = "vpc"
  tags   = { Name = local.name }
}
resource "aws_eip_association" "management" {
  instance_id   = aws_instance.management.id
  allocation_id = aws_eip.management.id
}
output "instance_id" {
  value     = aws_instance.management.id
  sensitive = true
}
output "public_ip" {
  value     = aws_eip.management.public_ip
  sensitive = true
}
