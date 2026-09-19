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
}

run "reject_non_ip_content" {
  command = plan
  variables {
    qa_static_ip = "example.invalid"
  }
  expect_failures = [var.qa_static_ip]
}
