# 인프라 확정 사항과 남은 결정

2026-09-19 기준. 설계·파일 준비와 실제 자원 배포를 구분한다.

## 확정·준비한 사항

| 항목 | 상태 |
|---|---|
| 공개 소스 / private ops 분리 | 사용자 승인, h66rogi/rogichat-ops 생성 및 qa 검증 CI 구성 |
| 운영자 SSH 공개키 | 사용자 지정 키를 private ops에 등록, 전체 목록 검증·렌더링 도구와 공격 입력 테스트 |
| 개인키 | 기존 관리 장비에 유지, GitHub 업로드 없음 |
| QA API | DNS-only + Caddy 승인, Terraform DNS root 및 Caddy bootstrap 준비 |
| AWS | 서울 QA 독립 root, 실제 plan: instance/key pair/static IP/attachment/firewall 5개 생성, 기존 변경·삭제 0 |
| Terraform state | 기존 S3 backend 재사용, rogichat 전용 두 prefix, bucket 자체 미변경 |
| CI | public 보안 검사·mock IaC/Caddy/Compose 검증, private 키 목록·secret 검사; cloud 권한 없음 |
| 웹 푸시 | Service Worker/Web Push 요구 확정, 제품·인프라 조건 별도 기록 |

현재 로기챗 서버는 없고 API DNS 조회에도 A 응답이 없다. 서버 IP 없이 DNS 레코드를
먼저 만들지 않는다. Cloudflare token은 사용자가 발급 중이며 실제 zone/record 권한은
토큰 제공 뒤 확인한다. Caddy 자동 인증서 발급·tailnet 가입·서버 key reconciliation은
아직 실행되지 않았다. mock test는 cloud apply나 실서버 동작의 증거가 아니다.

## 실제 자원 생성 전에 정할 사항

1. **QA 크기·예산**: 권고는 `medium_3_0`, Linux/IPv4, 2 vCPU·4 GiB·80 GB, 월 USD 24.
   AWS 서울 live bundle API 조회값이며 세금·백업·초과 트래픽·별도 관리 서버 비용은 제외다.
   instance 하나에 DB/web/api가 함께 있으므로 부하 측정 후 조정한다.
2. **상시 관리 실행 위치**: 아래 비교에서 선택한다. 현재 개인키 정책을 유지하면
   일반 GitHub-hosted runner만으로 SSH 배포를 끝낼 수 있는 상태는 아니다.
3. **Tailnet 가입**: 현재 관리 장비의 tailnet 연결은 확인했지만 새 node 등록·tag/grant
   권한은 미확인이다. 일회성 등록 경로와 운영자→QA SSH 범위를 검증해야 한다.

DNS-only 승인과 private repo 생성 승인은 이미 받았다. 동일 범위를 다시 승인 대상으로
돌리지 않는다. 실제 Terraform 적용에서는 resource delta·가격·영향을 함께 확인한다.

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
