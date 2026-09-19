{
	admin localhost:2019
}

api.qa.rogi.chat {
	# Preserve the existing certificate/data volumes and infrastructure endpoints.
	# No access log: OAuth query strings and credentials must not be recorded.
	@hostkey path /_infra/ssh-host-key
	handle @hostkey {
		header Cache-Control "no-store"
		root * /srv/host-keys
		rewrite * /ssh_host_ed25519_key.pub
		file_server
	}
	@infra path /_infra/health
	handle @infra {
		respond "rogichat QA edge ready" 200
	}
	handle {
		# Use the globally unique container name, not the shared Compose alias "api".
		# DNS-only public ingress: Caddy is the sole proxy hop. Discard caller IP
		# claims and send exactly the socket peer IP for the API's trust-proxy=1.
		reverse_proxy rogichat-qa-api:3000 {
			header_up X-Forwarded-For {remote_host}
			header_up -CF-Connecting-IP
			header_up -Forwarded
		}
	}
}
