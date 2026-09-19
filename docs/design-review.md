# 기반 설계 다각도 리뷰

상태: private ops 분리와 API DNS-only + Caddy는 사용자 승인 완료. 실행기 배치는 논의 중.
독립 리뷰어나 다중 에이전트 검토를 수행한 것으로 간주하지 않는다.
실제 클라우드 자원과 앱은 아직 구축되지 않았다.

별도 [보안 검토 기록](security-review.md)에 적용한 통제와 잔여 위험을 기록했다.

## 검토 결과

| 관점 | 발견한 위험/차이 | 설계 반영 | 다음 검증 |
|---|---|---|---|
| 공개 저장소 | push 이후 CI만으로는 유출 예방 불가 | 로컬 index/history 검사 + 서버 Push protection | synthetic 공격 fixture와 서버 설정 read-back |
| Atlantis | plan도 credential 탈취 경로, hide 설정도 실시간 log는 남음 | public A안 상세화, public CI + private IaC/CD B안 권고 | private ops 승인, 실행기 배치·권한 분리 검증 필요 |
| Free private 운영 | 보호 브랜치/environments 제약, 조직 read 상속 | private ops + GitHub 밖 SHA/plan 승인, 공개 검증 CI 유지 | 운영자 접근 범위·외부 인가기 검증 |
| IaC 소유권 | 기존 bucket/OIDC 재선언은 이중 소유 발생 | 기존 소유 유지, rogichat state/role만 별도 | prefix IAM/KMS 권한, live backend 설정 |
| 기존 인프라 | 과거 설치 문서에 퇴역 자원이 섞임 | 최신 baseline만 활용 | 새 프로젝트 때문에 퇴역 자원 재생성 없음 |
| 재사용 | 최신 웹에서 talk 삭제됨 | 종료 전 qa/삭제 직전 SHA 조사 | 파일 단위 이식 provenance와 dependency audit |
| DB | MySQL 모델을 PostgreSQL에 그대로 사용 불가 | 신규 PG schema와 이식 테스트 | collation/JSON/locking/unique/time 검증 |
| 메시지 보안 | 팬 답장·replay가 다른 팬에게 보일 수 있음 | 수신자 authorization을 모든 조회/전달 경로에 적용 | 복수 팬·차단·탈퇴·재접속 공격 시나리오 |
| 독립 배포 | web/api 동시 Compose 갱신이 릴리스를 덮음 | 앱별 빌드 + 호스트 공통 lock + 서비스별 digest 갱신 | 동시 배포·실패·rollback 테스트 |
| Lightsail 접근 | SSH 키를 GitHub 밖에 보관해야 함 | Tailscale + OpenSSH, private ops 공개키 목록, public repo는 공개키도 차단 | bootstrap/reboot/복구·tailnet ACL 실증 |
| 가용성/비용 | 한 호스트에서 DB/API/web 동시 장애 | QA 한정, 외부 백업·용량 실측 | 복구 drill·peak/배포 중 메모리 |
| 네이티브 | 각 의존성 최신 버전을 모으면 빌드 불가 가능 | AGP/Kotlin/KSP/Hilt 및 Swift/SPM 호환 검증 | unsigned CI와 API fixture parity |
| 운영 분리 | QA 쿠키·키·signing이 prod로 번짐 | host-only cookie, 별도 role/state/DB/bundle ID | prod에 QA role 접근 차단 |
| 소셜로그인 | 기존 OAuth callback을 유지하면서 다른 서비스로 복귀 필요 | user/platform_soop 분리, QA API→broker→SOOP→broker→QA API + code 교환 | 실제 SOOP subject·가입/연결·replay·환경 혼동 검사 |
| TLS | api.qa.rogi.chat은 Universal SSL 기본 범위 밖, SSL Rule은 passthrough가 아님 | API DNS-only + Caddy 공개 신뢰 인증서 승인 | HTTPS/WSS·갱신·웹 origin 우회/forwarded header 검증 |
| 브랜딩 | 원본 UI·SDK·외부 동의 화면에 기존 이름 잔존 가능 | 제품은 로기챗 전용, 필수 인프라 의존과 분리 | SOOP 등록 앱 이름 변경 가능 여부 |

## 주요 결정 기록

- 확정: AWS 서울, QA `qa.rogi.chat`, prod `rogi.chat`, qa 우선 작업.
- 확정: Terraform 소유권은 rogichat에 독립, 기존 인증·공유 관리 리소스는 재사용 검토.
- 확정: SOOP 소셜로그인, `user`/`platform_soop` 연결, 기존 OAuth callback 유지,
  `api.qa.rogi.chat`으로 돌아와 로기챗 자체 세션 발급.
- 확정: Tailscale 연결, OpenSSH 키 인증, 개인키는 GitHub 밖, 공개키는 private ops GitOps 관리(추가 승인).
- 확정: 제품명 로기챗, 기존 제품 브랜딩/자산 제거.
- 제안: pnpm/Turbo + 네이티브 Gradle/SPM, 언어 중립 계약과 생성 SDK.
- 제안: QA는 reverse proxy/Next/Nest/PostgreSQL Compose. Redis는 추출 의존에 따라 추가.
- 확정: public `rogichat` 소스·IaC 템플릿·CI, private `rogichat-ops` 운영 명세·공개키.
  실행기 배치는 논의 중이다. [Free 제약과 공개 범위](repository-isolation.md) 참조.
- 확정: API `api.qa.rogi.chat`은 DNS-only + Caddy 자동 HTTPS. 웹은 proxied +
  Full(strict). 평문 OAuth나 SSL Off를 사용하지 않는다. [TLS 설계](host-access.md) 참조.
- 미확정: Atlantis 호스트·실행 저장소·승인자, 전용 배포 실행기와 tailnet 관리 권한.
- 구현: private ops/qa와 지정 운영자 공개키, 키 검증·렌더러, 검증 전용 Actions.
- 구현: QA AWS/Cloudflare 독립 root와 Caddy bootstrap. 실제 서버·DNS에는 아직 미적용.
- 확정 요구: Service Worker 웹 푸시. [기반 요구사항](web-push-foundation.md)을 후속 제품 설계에 포함.
- 미확정: 조직 read 상속 축소 필요 여부, QA Lightsail bundle, backup 저장 위치·RPO/RTO,
  Cloudflare zone 권한·제안 TLS 경로의 실제 발급/갱신.
- 인증 출시 게이트: broker 운영 지속, SOOP canonical subject, client credential 등록,
  외부 동의 화면 앱 이름. 구체 계약은 [인증 문서](soop-authentication.md)를 따른다.
- 후속 기능 검토: 약관/가입 세부 절차, 1:N 공개 범위, push notification,
  프로필/방명록 세부 권한, 파일 업로드와 데이터 보존 기간.

## 구현 단계와 통과 기준

1. **보안 foundation (이번 변경)**: 공개 원격 연결, qa, 구조·문서, 유출 차단 hook/CI,
   GitHub 보안 설정. 로컬 테스트와 remote CI 증거를 확인한다.
2. **검토 후 scaffold**: 최신 stable Next/Nest 기본 앱·health endpoints·Dockerfile,
   Android/iOS 최소 앱, workspace/lockfiles와 앱별 unsigned CI. cloud secret 없이 빌드.
3. **QA IaC**: backend/role bootstrap, Lightsail/DNS full plan, 검토된 apply,
   host secret 전달·TLS·백업. 승인된 자원 외 변경 0을 확인한다.
4. **QA delivery**: GHCR 발행, host 배포, migration·rollback·외부 smoke·복구 drill.
5. **기능별 이식**: 계약/인가 테스트를 먼저 만들고 chat → profile/guestbook 순서를 검토.
6. **prod 설계/승격**: QA 결과와 예상 동접·보존량·가용성 요구로 인프라를 결정한다.

보안 scanner 통과는 서비스 보안성 전체를 보증하지 않는다. 공개 가능성, 실제 권한,
origin 접근, 백업 복구와 앱 접근 제어는 각각 증거가 있어야 완료로 표시한다.
