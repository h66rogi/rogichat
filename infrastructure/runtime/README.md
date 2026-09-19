# Runtime contract

QA 호스트는 reverse proxy, web, api, PostgreSQL을 Docker Compose로 운영한다.
메시지 이식이 Redis에 의존하면 cache를 추가한다. 현재는 Caddy만 띄우는 bootstrap
Compose를 준비했고 web/api/DB용 운영 Compose는 앱 scaffold 이후 추가한다.

- image는 검증된 GHCR digest, build는 CI에서 수행.
- DB/cache는 내부 네트워크만 사용, host port 미공개.
- secret은 image/Compose 본문 대신 권한 제한 파일로 전달.
- 관리 접근은 Tailscale 위 OpenSSH. SSH 개인키는 GitHub 밖, 공개키는 private ops GitOps로 관리.
- QA web/API host를 분리하고 API callback TLS·host-only cookie·CORS를 검증.
- web/api만 개별 교체, 공통 host lock으로 manifest 갱신 직렬화.
- volume 보존, migration 별도 단일 작업, 이전 digest rollback 가능.
- 외부 DB backup과 restore drill, disk/log 제한, 실제 HTTP/socket 검증 필수.

`bootstrap.sh.tftpl`은 OS 패키지·Docker·Tailscale daemon·방화벽·SSH hardening과 Caddy를
설치한다. Tailscale 가입 자격증명은 주입하지 않는다. `compose.bootstrap.yaml`의 Caddy
2.11.4 이미지는 upstream manifest digest로 고정했고 `/data`, `/config`는 영속 volume이다.
`Caddyfile.bootstrap`은 `/_infra/health`만 200이며 앱 경로에는 503을 반환한다.
이 응답을 Nest readiness나 앱 배포 성공으로 해석하지 않는다. DNS가 실제 static IP를
가리킨 후 외부 SAN/chain/HTTP redirect를 검증해야 HTTPS 배포 완료다.

Cloudflare DNS token은 Caddy에 필요하지 않다. HTTP-01/TLS-ALPN-01을 사용하고 80/443을
열어 둔다. 웹 hostname은 앱 배포 시 별도 origin 우회 차단과 함께 추가한다.
[host 접근 설계](../../docs/host-access.md)의 bootstrap·가입·재부팅·인증서 검증을 따른다.
