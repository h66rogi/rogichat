# 공통 앱 기반 구현 진행

2026-09-20. [통합 계획](mobile-implementation-plan.md) MB02a–c 중 백엔드 없이 가능한 부분을
구현했다. [실제 재사용 단위](mobile-reuse-audit.md)의 R01–R08과 신규 코드를 구별한다.
기존 [첫 와이어프레임](mobile-wireframe-progress.md) 이후의 현재 상태 기록이다.

## 이번 구현

- Android navigation/top bar·settings row/section·button·loading/empty, iOS MyPage section/row·
  loading/empty 표현을 실제 코드 단위로 추출했다. 브랜드·사업 모델·고정 높이·단일 행 제약을
  제거하거나 보강하고 원본 추출/신규 구현을 ledger에 기록했다.
- shared AppShell과 대화/설정 탭, 탭별 메모리 stack, 상태별 route gate를 추가했다.
  SOOP 연결 필요 상태에도 계정 관리 접근을 제공한다. SignedOut/복원/오류/차단/종료 상태는
  개인 프로필·계정 상세를 열지 않는다. 상태/역할 변경 시 이전 상세 path와 QA 초안을 지운다.
- QA에서 팬/스트리머와 이용 상태 7종을 선택한다. SOOP 안내의 `방 1개 계정 화면 미리보기`는
  최초 1회 방을 열며 목록/설정 복귀 시 강제 재진입하지 않는다. 일반 시나리오는 샘플 방 2개다.
- 설정 → 내 프로필/계정 관리/알림/앱 정보·지원을 조립했다. 계정·프로필은 QA 미연동 페이지다.
  버전/build/environment는 실제 bundle/BuildConfig에서 읽는다. 정책 URL/문의는 준비 중이다.
- 알림 화면의 **권한 확인**과 **시스템 알림 설정 열기**는 실제 OS 호출이다. 권한 요청·채널 생성·
  푸시 SDK 초기화·기기 등록은 하지 않는다. OS 상태 조회를 선택한 이후 화면 복귀 시 재조회한다.
  서버 preference와 binding은 별도로 `미연동` 표시하며 성공한 토글/저장처럼 보이지 않는다.
- 안전한 content URL parser와 pending route queue를 순수 모델로 준비했다. HTTPS·주입한
  host/path policy·ID만 허용하고 userinfo/port/query/fragment/encoding 우회는 거부한다.
  최신 intent 1개, 5분 TTL, 64개 이내 소비 중복 기록, scope/revision 기반 stale 결과 폐기를
  검사한다. clock 입력은 monotonic이며 queue는 단일 호출자/actor에 한정한다.

## 정확한 경계와 남은 작업

| 항목 | 현재 상태 | 다음 연결 조건 / 계속 가능한 작업 |
|---|---|---|
| 공통 UI MB02a | source 추출·양 OS 화면 연결, 코드/빌드 검사 | 기기 접근성·큰 글자·작은 화면·다크 모드 확인은 미완료; 다음 조립 가능 |
| shell MB02b | route gate·탭 stack·QA 1방 초기 진입 구현 | 실제 SessionManager/계정 scope는 C01–03/08 뒤 연결. QA 인가 상태는 실제 인증 아님 |
| 상태 복원 | 같은 실행 안의 탭 path/QA draft 유지, 환경/계정 변경은 reset contract | 앱 종료 및 Android Activity 재생성 시 미리보기 초기화. private 화면의 영속 복원은 실제 세션/저장 계약 뒤 |
| 프로필/계정 상세 | 기존 QA 폼과 종료 동작 유지 | 실제 저장·logout·탈퇴 command 및 확인 UI는 서비스 계약에 따라 연결. 현재 실제 파괴적 동작 없음 |
| 알림 MB02c | read/settings-open와 화면 복귀 재조회, 세 축 분리 | 실제 prompt/permission request와 provider/binding/preference는 C09/MB07에서 연결 |
| 링크 MB02c | 주입형 parser/queue와 경쟁 검사 | **OS intent/Universal Link/푸시 callback에 연결하지 않음**. 테스트 host/path는 합성 정책이며 공개 URL 계약 아님. allowlist·C02 auth callback 분리·C03 재인가 coordinator 필요 |
| pending 소비 | 오래된 scope offer/인가 결과가 새 intent를 덮거나 지우지 못함 | consume은 인가 성공 증거가 아니다. 미래 coordinator가 실제 권한 확인 후 같은 actor turn에서 consume+navigation할 것. logout/환경 변경에서 resetScope, callback 등록 시 scope capture 필수 |
| 서버/저장 MB02d | 구현하지 않음 | C01/07/08 및 실제 DB/secure store 정책 확정 후 adapter 착수; 미확정 API를 임의 추가하지 않음 |
| 알림함/badge·정책 링크 | 준비 중 또는 미노출 | 제품 의미/서버 이력/게시 주소 확정 필요; 기존 서비스 URL·badge 의미 미승계 |

prod는 공통 shell/일반 설정/OS 조회/앱 정보까지 제공한다. 서비스 access는 SignedOut으로
고정하며 QA 역할 선택·synthetic 계정/방·서비스 페이지 진입은 포함하지 않는다. fixture의
QA 포함/prod 제외를 실제 APK와 iOS 실행 파일에서 검사한다. 기존 “prod 시작 화면만” 기록은
이 구현 이후 **로그인 대기 + 일반 설정 shell**로 갱신됐다.

## 검증과 다음 작업

- Android 네 variant assemble/JUnit/lint, APK 환경/서명/fixture 격리.
- Swift 실제 reducer host 검사 및 iPhoneOS 네 구성 빌드/fixture 격리. Simulator를 부팅하지 않는다.
- 제한 계정의 계정 관리, SignedOut/차단 상태의 private route 거부, 탭별 상세 유지,
  역할/상태 변경 초기화, 팬 PRIVATE/스트리머 대상 선택과 기존 초안 분리 회귀를 검사한다.
- 단일 방 auto-enter의 역방향 복귀, URL 입력 거부, 중복/만료/scope reset, A 인가 중 B tap,
  scope 변경 후 늦은 callback offer 거부를 양 OS 상태 검사에 포함했다.
- 실제 OS 설정 화면·키보드·뒤로 제스처·VoiceOver/TalkBack·큰 글자·기기 설치 QA는 미확인이다.
  빌드/상태 검사로 UI 사용성이나 실제 provider 연동 성공을 주장하지 않는다.

다음 독립 작업은 위 기기 UI 확인과 설정/계정 상세의 공통 화면 모델 정리다. allowlist/계정
재인가 계약이 합의되면 준비된 route queue를 실제 coordinator에 연결한다. C09 전에는 알림
선호 설정 저장·푸시 등록·전달 성공을 구현 완료로 처리하지 않는다. 채팅 UX는 별도 설계한다.
