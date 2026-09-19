# 인프라 확정 사항과 남은 결정

2026-09-20 갱신. 설계·파일 준비와 실제 자원 배포를 구분한다.

## 확정·준비한 사항

| 항목 | 상태 |
|---|---|
| 공개 소스 / private ops 분리 | 사용자 승인, h66rogi/rogichat-ops 생성 및 qa 검증 CI 구성 |
| 운영자 SSH 공개키 | 사용자 지정 키를 private ops에 등록, 전체 목록 검증·렌더링 도구와 공격 입력 테스트 |
| 개인키 | 기존 관리 장비에 유지, GitHub 업로드 없음 |
| QA API | DNS-only A 레코드 적용 완료, Caddy 초기화 진단 중 |
| AWS | 서울 QA instance/key pair/static IP/attachment/firewall 생성 완료, 2 vCPU·4 GiB·80 GB, Ubuntu 24.04, 기본 USD 24/월 |
| Terraform state | 기존 S3 backend 재사용, rogichat 전용 두 prefix, bucket 자체 미변경 |
| CI | public 보안 검사·mock IaC/Caddy/Compose 검증, private 키 목록·secret 검사; cloud 권한 없음 |
| 웹 푸시 | Service Worker/Web Push 요구 확정, 제품·인프라 조건 별도 기록 |

## 실제 적용 결과와 현재 차단점

- 사용자가 월 기본 USD 24 사양의 생성을 승인했고 QA 전용 자원을 생성했다.
  기존 서비스 자원은 변경하지 않았다. 고정 IP와 SSH 공개키 등록을 유지한 채,
  앱·DB·데이터가 없는 초기 QA 호스트만 bootstrap 수정을 위해 재생성했다.
- `api.qa.rogi.chat`은 고정 IP의 DNS-only A 레코드다. Cloudflare API와 권한 DNS 서버
  응답을 확인했고, AWS·Cloudflare 적용 후 전체 plan은 모두 변경 0건이었다.
- 현재 인스턴스는 running, SSH 22는 운영자 /32에서 연결된다. 80/443은 연결 거부다.
  Caddy HTTPS·cloud-init 완료·SSH 인증·Tailscale 설치/가입은 아직 실서버 검증 전이다.
  Terraform 성공이나 mock CI 통과를 런타임 완료로 해석하지 않는다.
- AWS access-details가 hostKeys를 반환하지 않고 Caddy도 아직 동작하지 않아 최초 SSH
  신뢰 정보를 확보하지 못했다. 검증 없는 TOFU 접속으로 우회하지 않았다.
- 진단용 `enable_browser_ssh_diagnostics`는 기본 false다. 별도 승인된 plan에서만
  bootstrap SSH에 AWS `lightsail-connect` 주소 대역을 잠시 추가하며, 호스트 키를
  검증하면 즉시 false로 복원한다. 운영자 /32와 80/443은 그대로 유지한다.
  호스트 UFW가 이미 활성화되어 있으면 provider 방화벽 변경만으로 접속이 보장되지 않는다.
- 인스턴스 `prevent_destroy=true`를 복구했다. 진단 전에 반복 재생성하지 않는다.
- 사용자 Cloudflare 토큰은 macOS Keychain `rogichat-cloudflare-dns`에 있으며 Git·CI·
  서버에 전달하지 않는다. 실제 승인된 DNS 레코드 생성으로 DNS Edit 동작을 확인했다.
- private ops의 공개키 전체 목록·원자적 교체·실패 rollback 도구와 테스트를 준비했다.
  새로운 SSH 세션은 사용자 config·agent·연결 공유를 차단하고 지정 키로 재인증한다.
  현재 서버의 authorized_keys reconciliation은 접속 신뢰 검증 후에 실행한다.

## 남은 인프라 결정

1. **상시 관리 실행 위치**: 아래 비교에서 선택한다. 현재 개인키 정책을 유지하면
   일반 GitHub-hosted runner만으로 SSH 배포를 끝낼 수 있는 상태는 아니다.
2. **Tailnet 가입**: 기존 관리 장비의 연결은 확인했지만 새 node 등록·tag/grant는
   아직 검증 전이다. 새 SSH 세션과 재부팅 후 접근을 확인한 뒤 공인 SSH를 닫는다.
3. **초기화 진단**: 추가 방화벽 plan은 기존 자원 생성 승인을 반복 요청하는 것이 아니라
   임시 관리 접근 대역 확대를 별도로 검토하는 것이다. 상세 실행 증거는 private ops에 둔다.

## GitHub Actions와 Atlantis가 실행되는 곳

GitHub Actions는 작업을 시작하는 자동화 시스템이며 hosted runner는 작업 동안 사용하는
임시 장비다. Atlantis는 별도 서버 프로그램이다. private repo를 만들었다고 Atlantis나
SSH 배포용 장비가 생기는 것은 아니다.

| 방식 | GitHub Actions 역할 | 실제 적용·Atlantis 위치 | 조건·차이 |
|---|---|---|---|
| 외부 관리 Linux 장비 | 검증·빌드·이미지 발행·배포 요청 | 기존 또는 전용 관리 장비, tailnet 연결 | 개인키 GitHub 밖 유지, 상시 자동화 가능; 장비 선정/운영 필요 |
| private 전용 self-hosted Actions runner | GitHub에서 작업 시작·진행 확인 | 관리 장비 위 runner; Atlantis도 별도 서비스로 배치 가능 | public PR과 완전 분리, 승인된 명세만 실행; runner를 두는 장비 자체는 여전히 필요 |
| 현재 Mac에서 초기 적용 | 검증·빌드·이미지 발행 | Mac의 관리 CLI, Atlantis 상시 실행 없음 | 추가 서버비 없음, Mac이 꺼지면 적용 불가; 상시 자동화의 최종 형태가 아님 |
| 일반 hosted Actions에서 SSH까지 | 검증·빌드·적용 | GitHub 임시 runner; Atlantis는 대체 또는 별도 필요 | 배포용 개인키 전달이나 별도 keyless 배포 수단이 필요하여 현재 정책과 다름 |

별도 관리 장비가 있다면 private ops만 처리하도록 격리한 실행기를 권고한다.
일반적인 self-hosted runner에 cloud/개인키를 주고 repo의 모든 shell을 실행하는 방식은
관리 장비가 있어도 안전하지 않다. 서버에 고정한 실행 정책·승인 SHA와 최소 권한이 필요하다.
앱/DB Lightsail에 광범위 cloud 권한의 Atlantis를 같이 설치하지 않는다.
현재 실행 위치는 사용자 질문에 설명을 보충한 뒤 논의 중이며 임의로 배치하지 않았다.
[Atlantis requirements](https://www.runatlantis.io/docs/requirements.html),
[Atlantis security](https://www.runatlantis.io/docs/security.html).

## 앱을 올리기 전 필요하지만 지금 제품 설계를 막지 않는 항목

- PostgreSQL 외부 백업 저장소·보존 기간·복구 목표: 일일 암호화 백업, RPO 24시간·RTO 2시간
  제안을 실제 restore 시험으로 확인한다. 현재 bootstrap에는 DB나 앱 데이터가 없다.
- Cloudflare zone token은 rogi.chat 전체 DNS를 편집할 수 있으므로 QA/prod의 API 권한 분리가
  자동 보장되지 않는다. 실행 정책은 허용 hostname·resource delta를 제한해야 한다.
- 조직 base read를 유지할지 운영자 전용 열람으로 좁힐지 결정한다. 현재는 조직 read 상속을
  유지하며 조직 전체 권한을 변경하지 않았다. write/실행 권한과 열람 권한을 구분한다.
- SOOP OAuth 중계 서비스의 지속 운영·client 등록·callback 계약은 인증 출시 게이트다.
- [웹 푸시 기반 요구사항](web-push-foundation.md)에 VAPID/구독/캐시·권한·iOS 조건을 기록했다.

저장소·키·DNS/TLS 구조는 확정됐으므로 제품 설계 초안에는 진입할 수 있다. 다음 순서는
가입/계정 연결·역할 → 1:N 수신자 권한 → 알림 정책 → 프로필/방명록 범위다. 서버가 실제로
배포됐다고 가정하거나 세부 기능 구현을 먼저 진행하지 않는다.
