variable "enable_webhook_ingress" {
  description = "Enable only after the exact ingress plan is approved and the version-only gateway is installed."
  type        = bool
  default     = false
}

# Separate rule resources avoid replacing the management security group.
# The SG deliberately has no inline ingress list, which would compete with these.
resource "aws_vpc_security_group_ingress_rule" "webhook" {
  for_each          = var.enable_webhook_ingress ? toset(["80", "443"]) : toset([])
  security_group_id = aws_security_group.management.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
  description       = each.key == "80" ? "Caddy ACME HTTP challenge and HTTPS redirect" : "Caddy GitHub webhook; all UI paths denied"
}
