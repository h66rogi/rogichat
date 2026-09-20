mock_provider "cloudflare" {}

variables {
  zone_id      = "test-zone"
  qa_static_ip = "192.0.2.42"
}

run "qa_api_has_direct_origin_tls" {
  command = plan
  assert {
    condition     = cloudflare_dns_record.qa_api.name == "api.qa.rogi.chat" && cloudflare_dns_record.qa_api.proxied == false && cloudflare_dns_record.qa_api.type == "A"
    error_message = "Only the QA API DNS-only IPv4 record is approved."
  }
  assert {
    condition     = length(cloudflare_dns_record.qa_web) == 0
    error_message = "The web hostname must remain unpublished until explicitly enabled."
  }
}

run "qa_web_uses_same_origin_without_proxy" {
  command = plan
  variables {
    publish_web = true
  }
  assert {
    condition = (
      length(cloudflare_dns_record.qa_web) == 1 &&
      cloudflare_dns_record.qa_web[0].name == "qa.rogi.chat" &&
      cloudflare_dns_record.qa_web[0].type == "A" &&
      cloudflare_dns_record.qa_web[0].content == cloudflare_dns_record.qa_api.content &&
      cloudflare_dns_record.qa_web[0].proxied == false &&
      cloudflare_dns_record.qa_web[0].ttl == 300 &&
      cloudflare_dns_record.qa_api.name == "api.qa.rogi.chat"
    )
    error_message = "QA web must share the approved host through direct Caddy TLS without altering the API name."
  }
}

run "reject_non_ip_content" {
  command = plan
  variables {
    qa_static_ip = "example.invalid"
  }
  expect_failures = [var.qa_static_ip]
}
