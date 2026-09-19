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

## API hostname의 인증서

`api.qa.rogi.chat`은 2단계 subdomain이다. 일반 Cloudflare full setup의 Universal
SSL만으로는 인증서가 적용되지 않는다. 우선 proxied 구성을 유지하고 해당 hostname을
포함하는 Advanced Certificate/Total TLS 또는 지원되는 custom certificate를 검토한다.
현재 계약·비용·설정은 미확인이고 결제/활성화하지 않았다.
[Cloudflare hostname coverage](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/).

DNS-only + origin의 공개 신뢰 인증서는 대안이지만 Cloudflare proxy 보호가 사라지고
origin 443 허용 범위도 달라진다. proxy 상태만 꺼서 해결하지 않는다. Cloudflare Tunnel도
edge hostname 인증서 요구를 없애지 못한다. 브라우저의 edge TLS와 Cloudflare→origin
TLS를 각각 검증한 후 OAuth callback 테스트를 시작한다.
