# 인프라 확정 사항과 남은 결정

2026-09-20 갱신. 설계·파일 준비와 실제 자원 배포를 구분한다.

## 확정·준비한 사항

| 항목 | 상태 |
|---|---|
| 공개 소스 / private ops 분리 | 사용자 승인, h66rogi/rogichat-ops 생성 및 qa 검증 CI 구성 |
| 운영자 SSH 공개키 | 사용자 지정 키를 private ops에 등록, 전체 목록 검증·렌더링 도구와 공격 입력 테스트 |
| 개인키 | 기존 관리 장비에 유지, GitHub 업로드 없음 |
| QA API | DNS-only A 레코드 적용 완료, Caddy HTTPS 200 확인 |
| AWS | 기존 Lightsail 생성·초기화 복구 완료; EC2 + Aurora 신규 28개 생성·실서버 검증 완료, DNS 전환 대기 |
| Terraform state | 기존 S3 backend 재사용, rogichat 전용 두 prefix, bucket 자체 미변경 |
| CI | public 보안 검사·mock IaC/Caddy/Compose 검증, private 키 목록·secret 검사; cloud 권한 없음 |
| 웹 푸시 | Service Worker/Web Push 요구 확정, 제품·인프라 조건 별도 기록 |

## 실제 적용 결과와 전환 상태

- 기존 Lightsail 인스턴스·공개키·고정 IP·IP 연결·방화벽과 API DNS-only를 적용했다.
  기본 사양은 2 vCPU·4 GiB·80 GB, Ubuntu 24.04, USD 24/월이며 아직 삭제하지 않았다.
- 초기 실패는 Lightsail이 추가하는 `/bin/sh` 실행 문맥 안에서 Bash 전용 `pipefail`을
  사용한 bootstrap 버그였다. 명시적 Bash 실행으로 소스를 수정하고 기존 서버에서
  재생성 없이 bootstrap을 복구했다. 최초 cloud-init 오류 이력은 남으며 성공으로 덮지 않는다.
- 사용자가 승인한 AWS 브라우저 SSH 대역을 잠시 허용했다. 인증된 AWS API가 반환한
  호스트 키로 최초 SSH trust를 pin한 뒤 방화벽을 즉시 원복했다. API read-back에서
  `lightsail-connect` alias 제거를 확인했다. 운영자 /32 접근만 남아 있다.
- Docker/Caddy와 tailscaled가 실행 중이고 `https://api.qa.rogi.chat/_infra/health`의
  정상 공개 CA 검증을 포함한 HTTP 200을 확인했다. 이는 앱 배포 성공을 뜻하지 않는다.
- private ops 공개키 reconciliation은 실제 서버에 적용하고 새 독립 SSH 인증 연결로
  검증했다. 재실행 시 승인된 키 목록과 동일함을 확인했다. 개인키는 GitHub 밖에 유지한다.
- 신규 EC2에서 SSM 호스트 키 확인 → tailnet 가입 → 공개키 목록 적용 → 새 SSH 인증과
  재부팅 후 재접속을 검증했다. 공인 SSH 포트는 열지 않았다.
- DB는 Aurora MySQL로 변경했다. [EC2/Aurora 전환안](ec2-aurora-review.md)의 사양·비용을
  승인받아 신규 28개 자원을 생성했다. Aurora available와 EC2에서의 TLS 1.3 CA/hostname
  검증을 통과했다. 적용 후 전체 plan은 변경 0건이다. API DNS 전환·Lightsail 삭제는 미실행이다.
- EC2 초기 SSH socket activation에 필요한 런타임 디렉터리를 준비하도록 소스를 보완하고
  SSM으로 복구했다. Tailnet의 RDS split-DNS 충돌은 이 EC2의 accept-dns=false로 해소했다.
  현재 호스트 검증 성공과 보존된 최초 cloud-init 오류 이력을 구분한다.

## 남은 인프라 결정

1. API DNS 전환과 검증 후 기존 Lightsail 정리. 조직 통합 청구의 RI 실제 할인 배분도 확인한다.
2. 상시 Atlantis/관리 실행 위치. GitHub-hosted CI만으로 상시 Atlantis 서버가 생기지는 않는다.
3. Tailnet 장기 운영 태그·키 만료 정책과 운영 DB의 복구 목표·reader 필요 여부.

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

- Aurora 백업/PITR과 복구 목표: 제안한 7일 보존과 QA RPO/RTO를 restore 시험으로 확인한다.
  현재 기존 Lightsail에는 DB나 앱 데이터가 없다.
- Cloudflare zone token은 rogi.chat 전체 DNS를 편집할 수 있으므로 QA/prod의 API 권한 분리가
  자동 보장되지 않는다. 실행 정책은 허용 hostname·resource delta를 제한해야 한다.
- 조직 base read를 유지할지 운영자 전용 열람으로 좁힐지 결정한다. 현재는 조직 read 상속을
  유지하며 조직 전체 권한을 변경하지 않았다. write/실행 권한과 열람 권한을 구분한다.
- SOOP OAuth 중계 서비스의 지속 운영·client 등록·callback 계약은 인증 출시 게이트다.
- [웹 푸시 기반 요구사항](web-push-foundation.md)에 VAPID/구독/캐시·권한·iOS 조건을 기록했다.

저장소·키·DNS/TLS 구조는 확정됐으므로 제품 설계 초안에는 진입할 수 있다. 다음 순서는
가입/계정 연결·역할 → 1:N 수신자 권한 → 알림 정책 → 프로필/방명록 범위다. 서버가 실제로
배포됐다고 가정하거나 세부 기능 구현을 먼저 진행하지 않는다.
