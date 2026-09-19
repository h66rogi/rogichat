# EC2 접근: Tailscale + OpenSSH

확정: 서울 QA 앱 EC2와 별도 관리 EC2를 기존 tailnet에 연결했다. 서버에는 승인된 SSH 공개키만
등록한다. 개인키는 GitHub 저장소/Secrets/log/artifact/image에 올리지 않는다.
2026-09-19 추가 승인에 따라 공개키는 private `rogichat-ops`에서 GitOps로 관리하며,
이 공개 저장소에는 계속 올리지 않는다. Tailscale은 네트워크이고 사용자 인증은 OpenSSH key로 유지한다.
Tailscale SSH의 keyless 인증은 이번 요구의 대체 수단으로 사용하지 않는다.
[Tailscale SSH 문서](https://tailscale.com/docs/features/tailscale-ssh).

## 인증 자산과 소유권

| 자산 | 보관 위치 | IaC/CI 경계 |
|---|---|---|
| 운영자 SSH 개인키 | 운영자 기기의 안전한 키 저장소 | Terraform·GitHub로 전달하지 않음 |
| 배포 SSH 개인키 | Tailscale 내부의 전용 관리 실행기 | GitHub secret이나 runner로 전달하지 않음 |
| 대응 공개키 | private ops의 access/qa/keys, EC2 key pair/authorized_keys | 승인된 ops SHA의 공개키 파일 입력; public Git·image 금지 |
| host key 검증 자료 | 관리 실행기의 비공개 known_hosts | TOFU 자동 수락·검증 해제 금지 |
| Tailscale 초기 등록 자격증명 | 관리 영역의 일회용 전달 경로 | user_data·plan·CI 로그에 포함 금지 |
| 가입 후 Tailscale node state | 호스트 root 소유 디렉터리 | 이미지에 bake하지 않음 |

새 키가 필요하면 관리 장치에서 만들고 **public import**로 EC2에 등록한다.
Terraform `tls_private_key`나 AWS key 생성 API로 개인키를 state에 넣지 않는다.
public key조차 값이 state에 들어갈 수 있으므로 state/plan은 비공개 관리 영역에
보관한다. public plan summary에는 키 본문과 민감 주소가 절대 나오지 않아야 한다.
Git에는 `file(var.ssh_public_key_path)` 같은 구조만 둘 수 있으며 실경로·키는 외부 입력이다.
[EC2 key pair 관리](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-key-pairs.html).

## 부트스트랩과 정상 접근

1. private ops의 승인된 공개키 파일로 EC2 key pair를 import한다. 개인키를 생성하거나 옮기지 않는다.
2. 공인 SSH를 열지 않고 SSM으로 초기 상태와 host key를 확인한다. 초기 패키지는 비밀 없이 설치한다.
3. 일회성 sign-in URL로 사용자가 회사 tailnet 가입을 완료한다. auth key를 user_data에 넣지 않는다.
   현재 두 장비는 일반 사용자 장비이며 태그·전역 ACL/grants·만료 정책은 변경하지 않았다.
4. SSM으로 확보한 host key를 관리 장비의 known_hosts에 pin하고 새 OpenSSH 인증을 검증한다.
   private ops 전체 key manifest를 reconcile한 뒤 새 세션과 반복 drift 일치를 확인한다.
5. 재부팅 후 tailnet/SSH/SSM/Docker를 확인한다. sshd는 password/root login을 금지한다.
   Tailscale SSH는 끄고 `accept-dns=false`, `accept-routes=false`를 유지한다. 특히 앱 EC2는
   RDS DNS를 native VPC resolver로 해석해 회사 tailnet의 기존 split-DNS 충돌을 피한다.
6. 관리망 장애·키 분실의 복구 경로는 인증된 AWS SSM이다. 공인 SSH 상시 개방에 의존하지 않는다.

두 EC2에서 새 SSH 인증·공개키 reconciliation·재부팅 후 접속을 검증했다. 초기 Lightsail은
EC2 API 경로 전환 검증 후 퇴역했다. 기존 Lightsail의 임시 /32·browser-SSH 절차는 현행
EC2 접근 절차가 아니며 Git history에만 남긴다.

장기 운영용 전용 tag/grant와 key expiry 정책은 별도 검토가 필요하다. 현재 회사 tailnet의
일반 접근 정책을 그대로 따르므로 새 VPC 분리만으로 tailnet 전체에서 격리됐다고 주장하지 않는다.
향후 credentialed worker는 일반 회사 tailnet 접근권 없이 별도 경계에 두어야 한다.

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

## API hostname의 인증서: DNS-only + Caddy 확정

사용자의 origin 인증서 직접 사용 의도에 맞춰 QA API는 **DNS-only + Caddy 자동 HTTPS**를
사용자 승인을 받았다. API DNS를 EC2로 전환했고 Caddy 인증서·정상 HTTPS·재부팅 후 복구를 검증했다.

```text
DNS 조회: Cloudflare authoritative DNS → EC2 Elastic IP
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
