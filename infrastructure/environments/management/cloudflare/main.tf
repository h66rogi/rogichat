variable "zone_id" {
  type      = string
  sensitive = true
}
variable "management_static_ip" {
  type      = string
  sensitive = true
  validation {
    condition     = can(cidrnetmask("${var.management_static_ip}/32"))
    error_message = "Provide the management host static IPv4 address."
  }
}
resource "cloudflare_dns_record" "atlantis" {
  zone_id = var.zone_id
  name    = "atlantis.qa.rogi.chat"
  type    = "A"
  content = var.management_static_ip
  proxied = false
  ttl     = 300
  comment = "Rogichat QA Atlantis webhook; direct Caddy HTTPS"
}
