{
	admin localhost:2019
	# Runtime reverse-proxy errors may carry OAuth URI/header data even when
	# access logs are disabled. Filter the default runtime logger as well.
	log default {
		format filter {
			wrap json
			fields {
				request>uri delete
				request>headers delete
			}
		}
	}
}

import /etc/caddy/sites/*.caddy

api.rogi.chat {
	# Preserve the existing certificate/data volumes and infrastructure endpoint.
	# No access log: OAuth query strings and credentials must not be recorded.
	@infra path /_infra/health
	handle @infra {
		respond "rogichat production edge ready" 200
	}
	handle {
		# Use the globally unique container name, not the shared Compose alias "api".
		# DNS-only public ingress: Caddy is the sole proxy hop. Discard caller IP
		# claims and send exactly the socket peer IP for the API's trust-proxy=1.
		reverse_proxy rogichat-prod-api:3000 {
			header_up X-Forwarded-For {remote_host}
			header_up -CF-Connecting-IP
			header_up -Forwarded
		}
	}
}
