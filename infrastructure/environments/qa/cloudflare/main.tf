variable "zone_id" {
  type      = string
  sensitive = true
}

variable "qa_static_ip" {
  type      = string
  sensitive = true
  validation {
    condition     = can(cidrnetmask("${var.qa_static_ip}/32"))
    error_message = "Provide the QA application host static IPv4 address."
  }
}

# Only the approved API hostname is managed here. Do not import/redeclare the zone
# or existing production records owned by another Terraform stack.
resource "cloudflare_dns_record" "qa_api" {
  zone_id = var.zone_id
  name    = "api.qa.rogi.chat"
  type    = "A"
  content = var.qa_static_ip
  proxied = false
  ttl     = 300
  comment = "rogichat QA API; direct Caddy HTTPS"
}
