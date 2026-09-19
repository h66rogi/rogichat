mock_provider "cloudflare" {}
variables {
  zone_id              = "test-zone"
  management_static_ip = "192.0.2.44"
}
run "management_record_does_not_change_application_or_production" {
  command = plan
  assert {
    condition     = cloudflare_dns_record.atlantis.name == "atlantis.qa.rogi.chat" && cloudflare_dns_record.atlantis.proxied == false && cloudflare_dns_record.atlantis.type == "A"
    error_message = "Manage exactly the QA webhook hostname with direct Caddy TLS."
  }
}
