# Lightsail 접근: Tailscale + OpenSSH

확정: 서울 QA Lightsail을 기존 tailnet에 연결한다. 서버에는 승인된 SSH 공개키만
등록하며 개인키·공개키 모두 GitHub 저장소, Secrets, Actions 로그/artifact, GHCR 이미지에
올리지 않는다. Tailscale은 네트워크이고 사용자 인증은 OpenSSH key로 유지한다.
Tailscale SSH의 keyless 인증은 이번 요구의 대체 수단으로 사용하지 않는다.
[Tailscale SSH 문서](https://tailscale.com/docs/features/tailscale-ssh).

## 인증 자산과 소유권

| 자산 | 보관 위치 | IaC/CI 경계 |
|---|---|---|
| 운영자 SSH 개인키 | 운영자 기기의 안전한 키 저장소 | Terraform·GitHub로 전달하지 않음 |
| 배포 SSH 개인키 | Tailscale 내부의 전용 관리 실행기 | GitHub secret이나 runner로 전달하지 않음 |
| 대응 공개키 | Lightsail key pair/host authorized_keys, 관리자의 비공개 파일 | IaC 실행 시 외부 파일 입력; Git·image 금지 |
| host key 검증 자료 | 관리 실행기의 비공개 known_hosts | TOFU 자동 수락·검증 해제 금지 |
| Tailscale 초기 등록 자격증명 | 관리 영역의 일회용 전달 경로 | user_data·plan·CI 로그에 포함 금지 |
| 가입 후 Tailscale node state | 호스트 root 소유 디렉터리 | 이미지에 bake하지 않음 |

새 키가 필요하면 관리 장치에서 만들고 **public import**로 Lightsail에 등록한다.
Terraform `tls_private_key`나 Lightsail key 생성 API로 개인키를 state에 넣지 않는다.
public key조차 값이 state에 들어갈 수 있으므로 state/plan은 비공개 관리 영역에
보관한다. public plan summary에는 키 본문과 민감 주소가 절대 나오지 않아야 한다.
Git에는 `file(var.ssh_public_key_path)` 같은 구조만 둘 수 있으며 실경로·키는 외부 입력이다.
[Lightsail SSH key 관리](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-ssh-in-amazon-lightsail.html).

## 부트스트랩과 정상 접근

1. 외부 공개키 파일로 전용 Lightsail key pair를 import하고 인스턴스가 참조하게 한다.
2. SSH 최초 접근은 운영자 고정 IP의 임시 `/32`와 IPv6 정책까지 IaC로 제한한다.
   관리자의 실제 IP는 Git 밖 입력이다. 초기 OS/Docker/Tailscale 패키지는 자격증명 없이 설치한다.
3. 외부 등록 경로로 Tailscale에 가입시키고 전용 `tag:rogichat-qa`를 부여한다.
   서버는 persistent node이며 재사용 가능한 장기 auth key를 startup script에 남기지 않는다.
4. tailnet ACL/grants와 host firewall에서 승인된 관리 주체 및
   `tag:rogichat-deployer` → QA host TCP 22만 허용한다. 기존 광범위 allow 규칙이
   이 제한을 무력화하지 않는지도 검사한다. 태그 소유자를 제한하고 다른 서비스 접근을 허용하지 않는다.
5. Tailscale 경로의 SSH와 재부팅 후 재접속을 확인한 뒤 public SSH 허용을 IaC에서 제거한다.
   sshd는 password/root login을 금지하고 승인 key만 유지한다. AWS 기본/system key가
   남아 있는지 점검해 운영자의 복구 경로를 확인한 후 승인 key 목록에 맞춘다.
6. 정상 접속은 `tailscale0` TCP 22와 등록 key 조합으로만 한다. Tailscale SSH 활성화는 하지 않는다.

2026-09-19 작업 장치의 Tailscale은 Running/online으로 확인했다. 이는 새 서버 가입,
태그 생성 권한이나 ACL 수정 권한을 확인한 결과가 아니다. 실제 서버·policy는 아직 변경하지 않았다.

관리망 장애·키 분실 때는 AWS 관리 권한으로 제한된 임시 SSH 경로를 복구하는 별도
절차가 필요하다. public SSH 상시 개방을 복구 수단으로 삼지 않는다. 원복도 IaC에 반영한다.

## GitHub 밖에서 수행하는 CD 제안

GitHub-hosted CI는 public source를 검증하고 신뢰된 qa commit에서 GHCR digest를
발행한다. tailnet 연결 정보나 SSH 키를 주지 않는다. 별도 관리 실행기가 검증된
commit·CI 결과·GHCR provenance/digest를 확인한 뒤 승인된 배포 명세를 받아 SSH로 적용한다.
공개 저장소가 지시한 임의 shell/Compose를 root로 실행하지 않는다.

호스트에는 관리 영역에서 검토·배치한 배포 helper와 Compose 경로를 둔다.
배포 key는 forwarding/PTY를 차단하고 forced command 또는 제한된 sudo helper로
서비스별 digest 교체만 허용한다. helper는 registry/repository/digest 형식, 환경,
경로, manifest schema를 검사하며 host lock 아래서 배포한다. Docker socket 접근이
root에 준한다는 점은 그대로 남으므로 일반 shell을 주지 않는다.

관리 실행기는 public repo의 self-hosted Actions runner로 등록하지 않는다.
허가된 webhook의 고정 명세 또는 polling으로 배포 요청을 받아 처리한다.
검증된 이미지에도 악성 앱 코드가 들어갈 수 있으므로 protected release review,
서명된 provenance, non-root/container 권한 제한과 runtime secret 최소화가 함께 필요하다.

대안으로 GitHub OIDC→Tailscale workload identity federation은 정적 tailnet secret을
줄일 수 있다. 하지만 OpenSSH 개인키 문제는 해결하지 않으므로 현재 기본안으로
선택하지 않는다. [Tailscale WIF](https://tailscale.com/docs/features/workload-identity-federation).

## API hostname의 인증서: DNS-only + Caddy 권고

사용자의 origin 인증서 직접 사용 의도에 맞춰 QA API는 **DNS-only + Caddy 자동 HTTPS**를
우선 제안한다. 아직 DNS나 SSL 설정을 변경한 상태는 아니다.

```text
DNS 조회: Cloudflare authoritative DNS → Lightsail static IP
API 연결: 사용자 ── HTTPS / 공개 신뢰 인증서 ── Caddy ── 내부 HTTP ── NestJS
```

`api.qa.rogi.chat`은 2단계 subdomain이어서 일반 Cloudflare full setup의 Universal
SSL 범위에 포함되지 않는다. DNS-only에서는 브라우저가 origin의 인증서를 직접 검증하므로
Caddy가 해당 이름의 Let's Encrypt 등 공개 신뢰 CA 인증서를 발급받으면 된다.
Cloudflare Origin CA 인증서는 일반 브라우저가 신뢰하지 않으므로 이 경로에 사용하지 않는다.
[hostname coverage](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/),
[DNS-only 동작](https://developers.cloudflare.com/dns/proxy-status/),
[Origin CA 주의사항](https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/).

도메인별 Configuration Rule로 SSL mode를 바꿀 수는 있지만 TLS passthrough가 되지는 않는다.
proxied HTTPS에서는 **브라우저↔Cloudflare edge**와 **Cloudflare↔origin**의 인증서가 각각
필요하다. origin에 Caddy 인증서를 설치해도 빠진 edge SAN을 보충하지 못한다.
Flexible은 브라우저 HTTPS/origin HTTP이며, 브라우저 HTTP/origin HTTPS라는 의미가 아니다.
SSL Off나 HTTP 로그인으로 우회하지 않는다. 로그인 callback·Secure cookie·API·WebSocket은
HTTPS/WSS로 유지한다. DNS-only hostname에는 Cloudflare HTTP/SSL Rule이 적용되지 않는다.
[SSL modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/),
[Flexible](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/flexible/).

### Caddy 발급·갱신과 호스트 설정

- DNS A는 해당 static IP를 가리키고 `proxied = false`로 관리한다. AAAA를 만들 경우
  실제 IPv6 경로·방화벽도 함께 검증한다. CAA가 있다면 선택 CA의 발급을 허용해야 한다.
- 호스트 80/443을 Caddy에 연결한다. 기본 HTTP-01은 80, TLS-ALPN-01은 443을 사용한다.
  80은 ACME와 HTTPS redirect에만 쓰고 API/OAuth 응답을 평문으로 서비스하지 않는다.
  이 방법에는 서버의 Cloudflare DNS API token이 필요 없다.
- Caddyfile에 `api.qa.rogi.chat`과 `reverse_proxy api:3000` 같은 내부 대상만 선언한다.
  실제 포트는 앱 scaffold에서 확정한다. Caddy 자동 발급·갱신을 사용하며 Certbot을 동시에
  돌려 같은 인증서/포트를 경쟁시키지 않는다. Certbot 선택 시 별도 renewal/reload가 필요하다.
- Docker의 Caddy `/data`를 영속·쓰기 가능 volume으로 보존한다. 인증서 개인키와 ACME
  계정 키를 Git/image/artifact에 넣지 않는다. 재배포 때 volume 삭제나 반복 재발급을 하지 않는다.
- 자동 HTTPS는 발급뿐 아니라 갱신 실패·외부 인증서 만료 관측까지 확인한다. 구현 중에는
  ACME staging으로 경로를 검증한 뒤 공개 신뢰 인증서의 SAN/chain/만료를 외부에서 검사한다.

Context7의 Caddy 공식 문서 조회로 발급 조건·자동 갱신·영속 data 요구를 확인했다.
[Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[reverse proxy](https://caddyserver.com/docs/quick-starts/reverse-proxy).

### 같은 호스트의 웹 프록시와 접근 제어

웹 `qa.rogi.chat`은 proxied + Full(strict)를 유지하는 안이다. API가 DNS-only이므로
같은 호스트 443을 Cloudflare IP에만 제한할 수 없고, static IP도 공개된다.
웹의 edge 보호를 유지하려면 Caddy의 **웹 hostname**에 Cloudflare source IP 검증 또는
Authenticated Origin Pull 검증을 적용하고 직접 접속을 거부한다. API hostname은 일반
클라이언트를 허용한다. 알 수 없는 Host/SNI는 앱으로 라우팅하지 않는다.
웹 origin 인증서의 발급 경로는 HTTP-01 예외·갱신 시험 또는 외부 배치 중 구현 시 확정한다.

API에는 Cloudflare WAF/cache/HTTP rate limit이 적용되지 않는다. 로그인·callback·소켓
연결 제한과 abuse 제어는 API/호스트에 구현한다. direct API가 전달한 CF-Connecting-IP나
X-Forwarded-For를 무조건 신뢰하지 않는다. Nest는 내부 Caddy hop만 신뢰하고, Caddy는
직접 연결과 신뢰된 Cloudflare 연결을 구분해 client IP를 전달한다.
HTTP 요청 제한은 DDoS 방어를 대체하지 않으므로 부하/공격 시 호스트 영향도 남는다.
[공유 origin IP 노출](https://developers.cloudflare.com/dns/manage-dns-records/troubleshooting/exposed-ip-address/).

검증: 외부 API HTTPS/WSS·OAuth callback·Secure cookie, HTTP redirect, 재시작 후 인증서
유지와 갱신, 직접 IP+웹 Host 우회 차단, 위조 forwarded header, IPv4/IPv6 경로를 검사한다.
QA 선택을 prod의 최종 edge 정책으로 자동 승격하지 않는다.
