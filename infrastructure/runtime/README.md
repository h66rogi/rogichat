# Runtime contract

QA 앱 호스트는 reverse proxy, web, api를 Docker Compose로 운영하는 설계다.
DB는 MySQL 계열로 변경했으며 private Aurora MySQL로 분리하는 전환 방향이 승인됐다.
메시지 이식이 Redis에 의존하면 cache를 추가한다. 현재는 Caddy만 띄우는 bootstrap
Compose를 준비했고 web/api용 운영 Compose는 앱 scaffold 이후 추가한다.

- image는 검증된 GHCR digest, build는 CI에서 수행.
- DB/cache는 내부 네트워크만 사용, host port 미공개.
- secret은 image/Compose 본문 대신 권한 제한 파일로 전달.
- 관리 접근은 Tailscale 위 OpenSSH. SSH 개인키는 GitHub 밖, 공개키는 private ops GitOps로 관리.
- QA web/API host를 분리하고 API callback TLS·host-only cookie·CORS를 검증.
- web/api만 개별 교체, 공통 host lock으로 manifest 갱신 직렬화.
- volume 보존, migration 별도 단일 작업, 이전 digest rollback 가능.
- 외부 DB backup과 restore drill, disk/log 제한, 실제 HTTP/socket 검증 필수.

`bootstrap.sh.tftpl`은 OS 패키지·Docker·Tailscale daemon·방화벽·SSH hardening과 Caddy를
설치한다. Tailscale 가입 자격증명은 주입하지 않는다. EC2는 `start_caddy=false`로 파일만 준비하고
승인된 DNS 전환 후 Caddy를 시작한다. Lightsail은 외부 `/bin/sh` 실행과 관계없이
명시적으로 Bash를 호출해야 하며, 최초 실패 로그로 이 조건을 확인했다. `compose.bootstrap.yaml`의 Caddy
2.11.4 이미지는 upstream manifest digest로 고정했고 `/data`, `/config`는 영속 volume이다.
`Caddyfile.bootstrap`은 `/_infra/health`에 200, 앱 경로에 503을 반환하도록 설계했다.
`/_infra/ssh-host-key`는 복사한 서버 Ed25519 호스트 공개키 한 파일만 제공한다. 최초
SSH 신뢰 설정 시 정확한 API hostname의 정상 공개 CA TLS 검증과 DNS/IP 일치를 확인하고,
redirect를 따라가지 않는다. 운영자 키·개인키는 노출하지 않으며 기존 pinned key를
자동 교체하지 않는다. 서버 호스트 키 회전 시 snapshot 갱신과 별도 검증이 필요하다.
이 응답을 Nest readiness나 앱 배포 성공으로 해석하지 않는다. DNS가 실제 static IP를
가리킨 후 외부 SAN/chain/HTTP redirect를 검증해야 HTTPS 배포 완료다.

Cloudflare DNS token은 Caddy에 필요하지 않다. HTTP-01/TLS-ALPN-01을 사용하고 80/443을
열어 둔다. 웹 hostname은 앱 배포 시 별도 origin 우회 차단과 함께 추가한다.
[host 접근 설계](../../docs/host-access.md)의 bootstrap·가입·재부팅·인증서 검증을 따른다.
