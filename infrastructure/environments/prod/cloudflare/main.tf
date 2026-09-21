variable "zone_id" {
  type      = string
  sensitive = true
}
variable "publish_dns" {
  type        = bool
  default     = false
  description = "Separate reviewed cutover only; foundation preparation creates no DNS records."
}
variable "production_static_ip" {
  type      = string
  sensitive = true
  default   = null
  validation {
    condition     = !var.publish_dns || can(cidrnetmask("${var.production_static_ip}/32"))
    error_message = "Publishing requires the verified production application EIP."
  }
}

variable "publish_marble_dns" {
  type        = bool
  default     = false
  description = "Separate reviewed cutover only; leaves the two Marble records absent by default."
}

variable "marble_static_ip" {
  type      = string
  sensitive = true
  default   = null
  validation {
    condition     = !var.publish_marble_dns || can(cidrnetmask("${var.marble_static_ip}/32"))
    error_message = "Publishing Marble DNS requires its verified application EIP."
  }
}
resource "cloudflare_dns_record" "production" {
  for_each = var.publish_dns ? toset(["rogi.chat", "api.rogi.chat"]) : toset([])
  zone_id  = var.zone_id
  name     = each.key
  type     = "A"
  content  = var.production_static_ip
  proxied  = false
  ttl      = 300
  comment  = "rogichat production; direct Caddy HTTPS"
  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_dns_record" "marble" {
  for_each = var.publish_marble_dns ? toset(["marble.rogi.chat", "marble-api.rogi.chat"]) : toset([])
  zone_id  = var.zone_id
  name     = each.key
  type     = "A"
  content  = var.marble_static_ip
  proxied  = false
  ttl      = 300
  comment  = "Rogi Marble production; direct Caddy HTTPS"
  lifecycle {
    prevent_destroy = true
  }
}
