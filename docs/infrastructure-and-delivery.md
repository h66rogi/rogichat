# 인프라와 독립 배포 설계

## 기존 인프라 활용 범위

사용자가 지정한 기존 Terraform 프로젝트를 읽고 AWS 프로필 인증과 서울 Lightsail
조회가 가능한 것을 확인했다. 기존 프로젝트의 최신 baseline은 과거 EKS/Vault의
재생성을 금지하고 보존 리소스와 신규 독립 스택을 구분한다.

재사용 후보는 **인증 경로, 원격 state 저장소, GitHub OIDC provider, 모듈 작성 패턴**이다.
기존 Lightsail 서비스는 변경 대상이 아니다. Atlantis의 살아 있는 endpoint와 실행
권한은 아직 확인되지 않았다. GitHub OIDC provider가 있다는 사실만으로 rogichat
trust role이 준비됐다고 판단하지 않는다. 계정/버킷/ARN/zone ID는 공개 문서에 적지 않는다.

소유권은 다음과 같이 분리한다.

| 소유자 | 대상 |
|---|---|
| 기존 Terraform 프로젝트 | 공유 backend bucket/KMS/OIDC provider 자체 |
| rogichat bootstrap root | rogichat 전용 IAM 역할·최소 권한 정책, 필요 시 전용 backend |
| rogichat QA AWS root | QA Lightsail, static IP, firewall, snapshot 정책 |
| rogichat QA Cloudflare root | `qa.rogi.chat`의 명시적 DNS/edge 설정 |
| rogichat prod root | 별도 state·권한·도메인, 초기 비활성 |

동일 리소스를 두 state에 선언/import하지 않는다. 공유 bucket을 사용하더라도
`rogichat/qa/aws.tfstate`, `rogichat/qa/cloudflare.tfstate`, `rogichat/prod/...`처럼
key를 분리하고 bucket List 권한도 prefix로 한정한다. 다른 프로젝트 remote state를
읽어 전체 출력을 노출하기보다 필요한 비밀 아닌 입력만 관리자 설정으로 전달한다.

기존 S3 backend의 versioning 활성화, public access block 전체 적용, encryption
설정을 read-only API로 확인했다. rogichat prefix 권한은 아직 만들지 않았다. Terraform의
`use_lockfile = true`로 state 잠금을 설계한다. lock object에는 필요한 Get/Put/Delete,
state에는 Get/Put만 부여하는 식으로 범위를 분리한다. 공유 backend 정책을 수정해야
하면 원래 소유 저장소의 별도 변경으로 처리한다. [S3 backend 공식 문서](https://developer.hashicorp.com/terraform/language/backend/s3).

## QA 구축 순서

1. 설계 리뷰에서 관리 실행 위치·인증 경로·호스트 bundle·백업 요구를 확정한다.
2. 기존 backend를 read-only 확인하고 rogichat bootstrap 권한·state 경로를 만든다.
3. AWS/Cloudflare provider와 Terraform 버전을 고정하고 lockfile을 커밋한다.
4. 네트워크·Lightsail·static IP·DNS 변경의 full plan을 검토한다.
5. 비밀 없는 cloud-init으로 OS/Docker/배포 사용자/방화벽만 준비한다.
6. 별도 인증 채널로 QA secrets와 origin TLS 자산을 배치한다.
7. GHCR 이미지·Compose·migration을 배포하고 HTTPS·API·소켓·DB backup을 검증한다.

현재 단계에는 apply나 DNS 변경이 없다. 계획에 없는 기존 인프라 drift를 함께
apply하지 않는다. Terraform plan은 credentialed 관리 영역에서만 실행한다.
Cloudflare provider는 v5 계열의 현재 스키마로 작성하며 v4 예제를 그대로 복사하지 않는다.
[Cloudflare Terraform 문서](https://developers.cloudflare.com/terraform/).

## 호스트 접근과 비밀 전달

Lightsail을 EC2 instance profile이 붙은 호스트처럼 가정하지 않는다. AWS OIDC는
Actions→AWS API 인증이며 host SSH 인증을 자동으로 해결하지 않는다.
첫 구현에서는 다음 두 경로를 비교해 하나를 검증한다.

- 제한된 관리 터널 위 SSH: 전용 배포 사용자, 고정 host key, 짧은 수명 인증 또는
  QA 전용 key. runner에 shell history나 command line으로 비밀을 노출하지 않는다.
- SSM hybrid managed node: 등록·권한·네트워크·비용을 확인한 경우만 사용한다.
  EC2용 SSM 문서를 Lightsail에 그대로 적용하지 않는다.

공용 runner의 IP를 위해 SSH를 전 세계에 열거나, AWS admin key를 호스트에 놓지 않는다.
Docker socket은 root에 준하는 권한이다. 공개 PR runner와 Atlantis 컨테이너에
앱 호스트 Docker socket을 마운트하지 않는다. 배포 계정이 실행할 수 있는 작업과
registry/image 이름을 제한하고 비밀은 root 소유 파일로 주입한다.

## 앱별 CI/CD

| 앱 | 검증 | qa 배포 산출물 | prod 승격 |
|---|---|---|---|
| web | lint/typecheck/test/Next build, image scan | `ghcr.io/h66rogi/rogichat-web@sha256:…` | 검증된 digest를 승격 |
| api | unit + PG integration + contract + build | `ghcr.io/h66rogi/rogichat-api@sha256:…` | migration 호환성을 확인하고 digest 승격 |
| Android | Gradle unit/lint/assemble | QA applicationId suffix, 내부 테스트 artifact | 별도 signing 환경·Play 내부 트랙부터 |
| iOS | Xcode build/test, SPM resolution | QA bundle ID, TestFlight | 별도 signing 환경·스토어 심사 경로 |
| infrastructure | fmt/validate/policy | Atlantis reviewed plan/apply | prod 프로젝트 명시적 승인 |

초기 live workflow는 보안 CI뿐이다. 위 앱 workflow는 scaffold 단계에서 생성한다.
GHCR은 Docker/OCI 이미지용이며 pnpm/Maven/SPM 저장소를 대체하지 않는다.
패키지는 우선 monorepo 내부 소비만 하므로 외부 package publish 권한이 필요 없다.

항상 실행되는 변경 감지 job이 앱별 affected 결과를 낸다. lockfile, 공통 계약,
루트 설정, reusable workflow 변경도 해당 소비자를 재검증한다. required check가
paths filter 때문에 영구 Pending이 되지 않게 최종 집계 job은 항상 실행한다.
PR은 빌드·테스트만 하고 qa의 신뢰된 push에서만 GHCR 쓰기·배포 권한을 부여한다.
build job과 deployment credential job을 분리하고 public PR artifact를 privileged
`workflow_run`에서 실행하지 않는다. CI에 cloud secret을 제공해 이미지 build하지 않는다.

각 앱 pipeline은 독립이지만 같은 호스트의 Compose manifest 변경은 하나의 host
배포 lock으로 직렬화한다. 서비스별 workflow concurrency만으로는 web/api의
동시 manifest 갱신을 막지 못한다. 배포 명세에 모든 서비스의 현재 digest를 기록하고
대상 서비스만 바꾼다. 오래된 workflow가 최신 배포를 덮지 않게 SHA 순서를 검사한다.
이미 진행 중인 DB migration이나 deploy는 cancel-in-progress로 중간 종료하지 않는다.

API migration은 단일 실행·expand/contract·사전 백업을 기본으로 한다. 앱 rollback은
이전 digest로 수행하며 DB down migration을 자동 실행하지 않는다. 모바일 구버전이
남아 있으므로 계약 변경은 서버→클라이언트 순서로 호환 기간을 둔다.

## 백업·복구·관측

QA의 잠정 목표: RPO 24시간, RTO 2시간. 요구 확정과 복구 실측이 필요하다.
매일 PostgreSQL 논리 백업을 외부 암호화 저장소에 업로드하고 7일 일별/4주 주별
보존을 제안한다. 앱 호스트와 같은 disk의 dump만으로는 백업이 아니다.
Lightsail snapshot은 보조 수단이며 일관된 DB backup·복구 시험을 대체하지 않는다.
PostgreSQL 18 이미지는 이전 major와 데이터 volume layout이 다를 수 있으므로
공식 이미지의 PGDATA/volume 경로를 구현 시 확인한다. major 업그레이드는 별도 작업이다.

HTTP uptime, API readiness, DB 연결, disk/memory, WebSocket disconnect·reconnect,
outbox lag, backup freshness를 감시한다. request ID와 build SHA를 사용하고 채팅
본문은 로그에 남기지 않는다. 통지 대상·경로는 운영자가 정한 후 연결한다.

배포 완료 증거: remote commit → CI 성공 → GHCR digest → 호스트 container digest/
health → 외부 HTTPS/API/소켓 smoke test → backup/restore 결과. 초기 QA는 단일
호스트이므로 재시작에 따른 소켓 단절과 복구가 정상적으로 처리돼야 한다.
