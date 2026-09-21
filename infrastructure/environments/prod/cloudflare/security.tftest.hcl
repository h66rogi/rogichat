mock_provider "cloudflare" {}
variables {
  zone_id = "00000000000000000000000000000000"
}
run "preparation_does_not_publish_dns" {
  command = plan
  assert {
    condition     = length(cloudflare_dns_record.production) == 0 && length(cloudflare_dns_record.marble) == 0
    error_message = "Production preparation must not publish DNS."
  }
}

run "marble_cutover_requires_ip" {
  command = plan
  variables { publish_marble_dns = true }
  expect_failures = [var.marble_static_ip]
}

run "marble_names_are_exactly_allowlisted" {
  command = plan
  variables {
    publish_marble_dns = true
    marble_static_ip   = "192.0.2.20"
  }
  assert {
    condition     = toset(keys(cloudflare_dns_record.marble)) == toset(["marble.rogi.chat", "marble-api.rogi.chat"]) && alltrue([for record in cloudflare_dns_record.marble : !record.proxied && record.type == "A" && record.ttl == 300])
    error_message = "Only the Marble web/API DNS-only A records may be managed."
  }
}

run "reject_malformed_marble_ip" {
  command = plan
  variables {
    publish_marble_dns = true
    marble_static_ip   = "not-an-ip"
  }
  expect_failures = [var.marble_static_ip]
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
