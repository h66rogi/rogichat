resource "aws_lightsail_key_pair" "bootstrap" {
  name       = "rogichat-qa-bootstrap"
  public_key = trimspace(file(var.ssh_public_key_path))
}

resource "aws_lightsail_instance" "qa" {
  # Reserve the distinct address before creating the host, including recovery
  # from an interrupted first apply with an unused address allocation.
  depends_on        = [aws_lightsail_static_ip.qa]
  name              = "rogichat-qa"
  availability_zone = "ap-northeast-2a"
  blueprint_id      = "ubuntu_24_04"
  bundle_id         = var.bundle_id
  ip_address_type   = "ipv4"
  key_pair_name     = aws_lightsail_key_pair.bootstrap.name
  # No credentials or key material in user_data. Key injection uses Lightsail import.
  user_data = templatefile("${path.module}/../../../runtime/bootstrap.sh.tftpl", {
    bootstrap_ssh_cidrs = sort(tolist(var.bootstrap_ssh_cidrs))
    compose_base64      = filebase64("${path.module}/../../../runtime/compose.bootstrap.yaml")
    caddyfile_base64    = filebase64("${path.module}/../../../runtime/Caddyfile.bootstrap")
  })

  lifecycle {
    # This host will hold persistent application data.
    prevent_destroy = true
    precondition {
      condition = (
        var.access_phase == "bootstrap" && length(var.bootstrap_ssh_cidrs) > 0 ||
        var.access_phase == "tailnet" && length(var.bootstrap_ssh_cidrs) == 0
      )
      error_message = "Bootstrap requires an operator /32. Remove public SSH only after verifying tailnet access and selecting tailnet phase."
    }
    # Bootstrap updates must be reconciled explicitly, never rebuild the DB host.
    ignore_changes = [user_data]
  }
}

resource "aws_lightsail_static_ip" "qa" {
  name = "rogichat-qa-ip"
}

resource "aws_lightsail_static_ip_attachment" "qa" {
  static_ip_name = aws_lightsail_static_ip.qa.name
  instance_name  = aws_lightsail_instance.qa.name
  lifecycle {
    replace_triggered_by = [aws_lightsail_instance.qa.id]
  }
}

resource "aws_lightsail_instance_public_ports" "qa" {
  instance_name = aws_lightsail_instance.qa.name
  lifecycle {
    replace_triggered_by = [aws_lightsail_instance.qa.id]
  }
  dynamic "port_info" {
    for_each = toset([80, 443])
    content {
      protocol          = "tcp"
      from_port         = port_info.value
      to_port           = port_info.value
      cidrs             = ["0.0.0.0/0"]
      ipv6_cidrs        = []
      cidr_list_aliases = []
    }
  }
  dynamic "port_info" {
    for_each = length(var.bootstrap_ssh_cidrs) > 0 ? [1] : []
    content {
      protocol          = "tcp"
      from_port         = 22
      to_port           = 22
      cidrs             = var.bootstrap_ssh_cidrs
      ipv6_cidrs        = []
      cidr_list_aliases = []
    }
  }
}

output "static_ip" {
  value       = aws_lightsail_static_ip.qa.ip_address
  description = "Pass as an explicit input to the separate Cloudflare root."
  sensitive   = true
}
