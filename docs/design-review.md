# 기반 설계 다각도 리뷰

상태: 작성자의 1차 검토 완료, 사용자와 함께 하는 설계 결정은 진행 중.
독립 리뷰어나 다중 에이전트 검토를 수행한 것으로 간주하지 않는다.
실제 클라우드 자원과 앱은 아직 구축되지 않았다.

별도 [보안 검토 기록](security-review.md)에 적용한 통제와 잔여 위험을 기록했다.

## 검토 결과

| 관점 | 발견한 위험/차이 | 설계 반영 | 다음 검증 |
|---|---|---|---|
| 공개 저장소 | push 이후 CI만으로는 유출 예방 불가 | 로컬 index/history 검사 + 서버 Push protection | synthetic 공격 fixture와 서버 설정 read-back |
| Atlantis | plan도 credential 탈취 경로, 공개 댓글/log 노출 | 별도 관리 영역, fork/임의 workflow 금지, 비공개 실행 경로 우선 | 실행 위치·접근 제어 확정 전 webhook 연결 금지 |
| IaC 소유권 | 기존 bucket/OIDC 재선언은 이중 소유 발생 | 기존 소유 유지, rogichat state/role만 별도 | prefix IAM/KMS 권한, live backend 설정 |
| 기존 인프라 | 과거 설치 문서에 퇴역 자원이 섞임 | 최신 baseline만 활용 | 새 프로젝트 때문에 퇴역 자원 재생성 없음 |
| 재사용 | 최신 웹에서 talk 삭제됨 | 종료 전 qa/삭제 직전 SHA 조사 | 파일 단위 이식 provenance와 dependency audit |
| DB | MySQL 모델을 PostgreSQL에 그대로 사용 불가 | 신규 PG schema와 이식 테스트 | collation/JSON/locking/unique/time 검증 |
| 메시지 보안 | 팬 답장·replay가 다른 팬에게 보일 수 있음 | 수신자 authorization을 모든 조회/전달 경로에 적용 | 복수 팬·차단·탈퇴·재접속 공격 시나리오 |
| 독립 배포 | web/api 동시 Compose 갱신이 릴리스를 덮음 | 앱별 빌드 + 호스트 공통 lock + 서비스별 digest 갱신 | 동시 배포·실패·rollback 테스트 |
| Lightsail 접근 | OIDC를 SSH/instance role로 오인할 수 있음 | AWS API와 host 접근을 별도 설계 | 터널 SSH 또는 SSM hybrid 실증 |
| 가용성/비용 | 한 호스트에서 DB/API/web 동시 장애 | QA 한정, 외부 백업·용량 실측 | 복구 drill·peak/배포 중 메모리 |
| 네이티브 | 각 의존성 최신 버전을 모으면 빌드 불가 가능 | AGP/Kotlin/KSP/Hilt 및 Swift/SPM 호환 검증 | unsigned CI와 API fixture parity |
| 운영 분리 | QA 쿠키·키·signing이 prod로 번짐 | host-only cookie, 별도 role/state/DB/bundle ID | prod에 QA role 접근 차단 |

## 주요 결정 기록

- 확정: AWS 서울, QA `qa.rogi.chat`, prod `rogi.chat`, qa 우선 작업.
- 확정: Terraform 소유권은 rogichat에 독립, 기존 인증·공유 관리 리소스는 재사용 검토.
- 제안: pnpm/Turbo + 네이티브 Gradle/SPM, 언어 중립 계약과 생성 SDK.
- 제안: QA는 reverse proxy/Next/Nest/PostgreSQL Compose. Redis는 추출 의존에 따라 추가.
- 제안: credentialed Atlantis는 비공개 관리 경계에서 검토된 SHA만 실행.
- 미확정: Atlantis 호스트·실행 저장소·승인자, 관리 네트워크와 host 배포 인증.
- 미확정: QA Lightsail bundle, backup 저장 위치·RPO/RTO, Cloudflare zone 접근 권한.
- 후속 기능 검토: 로그인/회원 모델, SOOP 연동 방식, 1:N 공개 범위, push notification,
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
