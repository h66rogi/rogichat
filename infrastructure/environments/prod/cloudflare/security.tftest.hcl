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

run "auth_is_off_during_existing_cutover" {
  command = plan
  variables {
    publish_dns          = true
    production_static_ip = "192.0.2.10"
  }
  assert {
    condition     = length(cloudflare_dns_record.auth) == 0
    error_message = "Existing production cutover must not enable auth."
  }
}

run "auth_requires_existing_cutover" {
  command = plan
  variables {
    publish_auth_dns     = true
    production_static_ip = "192.0.2.10"
  }
  expect_failures = [var.publish_auth_dns]
}

run "auth_requires_verified_ip" {
  command = plan
  variables {
    publish_dns      = true
    publish_auth_dns = true
  }
  expect_failures = [var.production_static_ip]
}

run "auth_adds_exactly_one_dns_only_record" {
  command = plan
  variables {
    publish_dns          = true
    publish_auth_dns     = true
    production_static_ip = "192.0.2.10"
  }
  assert {
    condition = length(cloudflare_dns_record.auth) == 1 && alltrue([
      for record in cloudflare_dns_record.auth : record.name == "auth.rogi.chat" && record.type == "A" && !record.proxied && record.ttl == 300 && record.content == var.production_static_ip
    ])
    error_message = "Auth cutover may add only the fixed DNS-only A record using the verified production EIP."
  }
  assert {
    condition     = toset(keys(cloudflare_dns_record.production)) == toset(["rogi.chat", "api.rogi.chat"])
    error_message = "Auth must not change existing record addresses or names."
  }
}
