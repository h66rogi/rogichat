mock_provider "cloudflare" {}
variables {
  zone_id = "00000000000000000000000000000000"
}
run "preparation_does_not_publish_dns" {
  command = plan
  assert {
    condition     = length(cloudflare_dns_record.production) == 0
    error_message = "Production preparation must not publish DNS."
  }
}
run "cutover_requires_production_ip" {
  command = plan
  variables { publish_dns = true }
  expect_failures = [var.production_static_ip]
}
run "approved_names_only" {
  command = plan
  variables {
    publish_dns          = true
    production_static_ip = "192.0.2.10"
  }
  assert {
    condition     = toset(keys(cloudflare_dns_record.production)) == toset(["rogi.chat", "api.rogi.chat"]) && alltrue([for record in cloudflare_dns_record.production : !record.proxied && record.type == "A" && record.ttl == 300])
    error_message = "Only production apex/API DNS-only A records may be managed."
  }
}

run "reject_malformed_cutover_ip" {
  command = plan
  variables {
    publish_dns          = true
    production_static_ip = "not-an-ip"
  }
  expect_failures = [var.production_static_ip]
}
