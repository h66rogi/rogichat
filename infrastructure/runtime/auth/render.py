#!/usr/bin/env python3
"""Render only fixed auth ingress templates; private bindings never enter Git."""
import argparse
import ipaddress
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
TAILNET = ipaddress.ip_network('100.64.0.0/10')


def tailnet_address(value):
    address = ipaddress.IPv4Address(value)
    if address not in TAILNET or address in (TAILNET.network_address, TAILNET.broadcast_address):
        raise ValueError('A single usable Tailscale IPv4 address is required')
    return str(address)


def render(node_ip, prod_ip, enabled=False):
    node, prod = tailnet_address(node_ip), tailnet_address(prod_ip)
    if node == prod:
        raise ValueError('Listener and production source must be distinct')
    caddy_forward = '''reverse_proxy http://@NODE_TAILNET_IP@:8310 {
            header_up -Forwarded
            header_up -X-Real-IP
            header_up -CF-Connecting-IP
            header_up -True-Client-IP
            header_up Host auth.rogi.chat
            header_up X-Forwarded-Host auth.rogi.chat
            header_up X-Forwarded-Proto https
            header_up X-Forwarded-Port 443
            header_up X-Forwarded-For {remote_host}
            header_down Cache-Control no-store
            header_down Pragma no-cache
            transport http {
                dial_timeout 3s
                response_header_timeout 10s
                read_timeout 15s
                write_timeout 10s
            }
        }'''
    nginx_forward = '''proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host auth.rogi.chat;
        proxy_set_header X-Forwarded-Host auth.rogi.chat;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port 443;
        # Intentionally identify the verified edge, never trust inbound IP claims.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Forwarded "";
        proxy_set_header CF-Connecting-IP "";
        proxy_set_header True-Client-IP "";
        proxy_set_header Connection "";
        proxy_set_header Upgrade "";
        proxy_connect_timeout 3s;
        proxy_send_timeout 10s;
        proxy_read_timeout 15s;
        proxy_next_upstream off;
        proxy_cache off;
        proxy_store off;
        proxy_buffering off;
        proxy_request_buffering on;
        proxy_max_temp_file_size 0;
        proxy_hide_header Cache-Control;
        proxy_hide_header Pragma;
        proxy_hide_header X-Powered-By;
        proxy_redirect off;'''
    result = {}
    for name, forward in [('Caddyfile', caddy_forward if enabled else 'respond 503'),
                          ('nginx.conf', nginx_forward if enabled else 'return 503;')]:
        value = (HERE / (name + '.template')).read_text().replace('@FORWARD@', forward)
        value = value.replace('@NODE_TAILNET_IP@', node).replace('@PROD_TAILNET_IP@', prod)
        if re.search(r'@[A-Z_]+@', value):
            raise ValueError('Unbound template placeholder')
        result[name] = value
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node-tailnet-ip', required=True)
    parser.add_argument('--prod-tailnet-ip', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--enable-proxy', action='store_true', help='Only after separate provider display/callback proof and operator review')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(HERE.parents[2]):
        parser.error('Render private bindings outside the public repository')
    try:
        rendered = render(args.node_tailnet_ip, args.prod_tailnet_ip, args.enable_proxy)
    except ValueError:
        parser.error('Invalid or identical Tailnet IPv4 bindings')
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, value in rendered.items():
        path = output / name
        # Refuse symlinks or overwrites; never follow a private output into Git.
        with path.open('x') as stream:
            path.chmod(0o600)
            stream.write(value)


if __name__ == '__main__':
    main()
