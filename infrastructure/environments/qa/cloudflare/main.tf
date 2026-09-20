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

variable "publish_web" {
  description = "Publish the QA web hostname only after its real application release is ready."
  type        = bool
  default     = false
}

# Preserve the existing API resource address. Production records belong to the
# separate production state; neither this opt-in nor a default plan changes them.
resource "cloudflare_dns_record" "qa_api" {
  zone_id = var.zone_id
  name    = "api.qa.rogi.chat"
  type    = "A"
  content = var.qa_static_ip
  proxied = false
  ttl     = 300
  comment = "rogichat QA API; direct Caddy HTTPS"
}

resource "cloudflare_dns_record" "qa_web" {
  count   = var.publish_web ? 1 : 0
  zone_id = var.zone_id
  name    = "qa.rogi.chat"
  type    = "A"
  content = var.qa_static_ip
  proxied = false
  ttl     = 300
  comment = "rogichat QA web; direct Caddy HTTPS"

  lifecycle {
    prevent_destroy = true
  }
}
