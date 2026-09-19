# Runtime contract

QA 호스트는 reverse proxy, web, api, PostgreSQL을 Docker Compose로 운영한다.
메시지 이식이 Redis에 의존하면 cache를 추가한다. 아직 deploy 가능한 Compose는 없다.

- image는 검증된 GHCR digest, build는 CI에서 수행.
- DB/cache는 내부 네트워크만 사용, host port 미공개.
- secret은 image/Compose 본문 대신 권한 제한 파일로 전달.
- 관리 접근은 Tailscale 위 OpenSSH. SSH 개인키·공개키는 GitHub 밖에 보관.
- QA web/API host를 분리하고 API callback TLS·host-only cookie·CORS를 검증.
- web/api만 개별 교체, 공통 host lock으로 manifest 갱신 직렬화.
- volume 보존, migration 별도 단일 작업, 이전 digest rollback 가능.
- 외부 DB backup과 restore drill, disk/log 제한, 실제 HTTP/socket 검증 필수.

SSH 방식은 확정됐으며 [host 접근 설계](../../docs/host-access.md)의 bootstrap·인증서·
배포 실행기 검증을 마친 뒤 그 계약을 만족하는 구성을 추가한다.
