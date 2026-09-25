# 프론트엔드 웹 구현 계획

> 2026-09-26 제품 결정: FAN 방에서 팬 메시지는 작성 팬과 방장에게만 보이며, 방장의 일반 메시지는 참여 팬에게 보인다. 방장의 특정 팬 비공개 답장은 메시지 선택으로 시작하고, 팬 메시지 전체공개는 별도 명시적 행동이다. 2026-09-24의 모든 역할 SHARED 결정은 이 결정으로 대체한다. 기존 팬 SHARED 기록도 열람 권한을 제한한다.

2026-09-20 업데이트. 현재 작업은 **QA와 운영에 동일한 production 웹을 배포하는 실제 API 연결**이다.
FW00/FW01의 미리보기는 과거 검토 산출물이며, 모든 배포에서 제거했다.
[production 구현 보고서](frontend-web-production-report.md)가 현재 구현·검증·제한의 기준이다.
서버 API는 커밋된 controller/service/DTO를 기준으로 사용하며, 준비되지 않은 계약은 완료로 표시하지 않는다.
[기반 진행 기록](frontend-web-foundation-progress.md)과 [리뷰 기록](frontend-web-implementation-review.md)은 역사 자료다.

QA/prod 모두 `NODE_ENV=production`과 하나의 동일한 빌드 구성을 사용한다. runtime
`ROGICHAT_WEB_ENV`·`ROGICHAT_API_ORIGIN`은 정확히 일치하는 허용 쌍만 사용한다.
선택적 `ROGICHAT_DEFAULT_ROOM_ID`가 없거나 빈 문자열이면 미개설 상태다. UUID가 설정되어도
API에서 해당 방의 접근·참여 상태를 다시 확인한다. 목록 첫 항목이나 이름으로 기본 방을 추정하지 않는다.

첫 목표는 **후로기의 홈 → 로그인·SOOP 연결 → 채팅 입장 → 실제 텍스트 왕복 →
새로고침 후 복구**다. 홈과 채팅 화면을 먼저 리뷰하고 서버 계약이 준비되는 순서대로 연결한다.
미디어·웹 푸시·삭제/탈퇴는 기존 제품 요구에 포함하며, 텍스트 연결만으로 출시 완료라 하지 않는다.

## 1. 확정한 제품 방향

| 항목 | 결정 |
|---|---|
| 제품 | 로기챗. 초기 사이트 전체가 후로기를 위한 공간 |
| 진입점 | `/`에서 후로기 채널 홈을 바로 표시. 로그인 후에도 홈의 의미는 유지 |
| 채널 | 스트리머 프로필·채팅·안내·관련 기능을 모으는 공간. 채팅방과 다른 개념 |
| 확장성 | 내부 채널 문맥과 경로 생성기를 분리. 첫 화면에 채널 목록·검색·전환 UI는 만들지 않음 |
| 재사용 | `meloming-front`의 채널 틀과 채팅 UI를 실제 이식 후보로 삼음 |
| 시각 방향 | 채널 기본 화면은 Airbnb 스타일, 채팅 대화 화면은 Messenger 웹 구조를 참고한 [웹 디자인 기준](../apps/web/DESIGN.md) |
| 참고 서비스 | 후로기 팀의 vvave 채널 구성·콘텐츠 흐름을 참고. 데이터 연동은 별도 계약 필요 |

웹 경로·디자인에 관해서는 이 문서가 기존 기반 설계의 일반적인 채널/스타일 제안을 구체화한다.
메시지 공개·권한·삭제 규칙은 [백엔드 제품 정책](backend-design.md), 실제 API는
[M03](backend-m03-implementation.md)–[M07](backend-m07-implementation.md)을 따른다.
기능 구현은 [기반 설계 리뷰](design-review.md)와 이 문서의 FW00 화면·이식 범위 리뷰 뒤에 진행한다.

## 2. 화면 구성과 MVP 경계

### 경로와 사용자 흐름

아래 경로는 웹 구현안이다. API 경로와 독립적으로 관리한다.

| 경로 | 초기 역할 | 접근·상태 |
|---|---|---|
| `/` | 후로기 프로필·대표 이미지·소개·공식 링크·채팅 진입·이용 안내 | 비로그인 공개. 확인된 공개 콘텐츠만 표시 |
| `/chat` | 후로기의 기본 채팅방 | 로그인 → SOOP 확인 → 현재 참여자 재인가 / 미참여자 명시적 입장 → 타임라인 |
| `/rules` | 채팅 이용 방법·신고/지원 안내 | 공개. 약관·개인정보처리방침과 구별 |
| `/login` | 로그인·실패/취소 후 복귀 | 서버가 허용한 인증 방식만 노출 |
| `/auth/login` | 현행 서버의 실패 callback 호환 경로 | `/login`으로 안전한 오류 상태만 전달. raw query 복사 금지 |
| `/auth/complete` | W08에서 제안하는 고정 웹 로그인 완료 경로 | session/bootstrap 검증 후 유효한 탭별 복귀 의도 처리 |
| `/settings` | 내 프로필·SOOP 연결·알림·방 퇴장·로그아웃·계정 탈퇴 | 계정 상태에 맞는 접근. 연결 미완료여도 계정 정리 가능 |
| `/schedule` | 후속 일정 기능 자리 | 데이터 원천·관리 방법 결정 후 메뉴 활성화 |

서비스 약관·개인정보처리방침의 공개 경로와 최종 문구는 인증 연결 전에 확보한다.
`/chat` 직접 진입과 알림 클릭도 같은 인증 gate를 통과하고 유효한 원래 화면으로 돌아온다.
복귀 URL은 검증한 사이트 내부 경로만 허용한다. `/`을 무조건 `/chat`으로 redirect하지 않는다.
현행 성공 callback은 `/`이므로 `/auth/complete`는 아직 구현된 계약이 아니다. 전환은 W08에서 검증한다.

입장은 렌더 부수 효과가 아니다. 미참여/퇴장 상태에는 이용 안내와 입장 버튼을 표시하고
사용자가 선택할 때 join한다. 알림 클릭·뒤로 가기·직접 URL만으로 재입장시키지 않는다.
방 퇴장은 계정 탈퇴와 별개이며 기존 메시지를 삭제하지 않는다고 안내한다. 방장 퇴장이 서버에서
제한되면 그 이유를 표시하고 우회하지 않는다. 재입장 후에는 새 참여 scope로 시작한다.

```text
후로기 홈 (/)
  ├─ 프로필 / 소개 / 공식 링크 / 이용 안내
  ├─ 채팅 → 로그인·SOOP 연결·입장 → 후로기 채팅 (/chat)
  └─ 내 설정 (/settings)
       이후: 일정 · 노래책 · 옷장 등 채널 기능을 순차 연결
```

데스크톱은 멜로밍 채널 구조를 활용한 프로필/메뉴 영역과 본문, 모바일은 간결한 상단과
핵심 메뉴로 시작한다. 채팅에서는 모바일 헤더를 축약해 타임라인과 입력 공간을 확보한다.
팬 화면은 공통 메시지와 본인의 개인 대화를 하나의 타임라인으로 보여준다. 스트리머는
같은 틀에서 전체 발송과 개인답장 대상을 명확히 구분한다. 관리자라는 이유로 개인 대화를 열지 않는다.

### 세 단계로 구분하는 산출물

1. **화면 검증:** 실제 production 화면을 격리된 테스트 서버의 합성 응답으로 검증한다. 합성 계정·역할·채팅·설정은 배포 소스에 넣지 않는다.
2. **실제 텍스트 연결:** 인증·입장·전송·history·sync·복구·공개·반응을 QA API에 연결.
3. **출시 후보:** 미디어·프로필·Web Push·계정 lifecycle을 연결하고 실제 기기·권한·삭제 검증 완료.

일정·노래책·옷장·방명록의 신규 제작, 채널 탐색/입점, 일반 그룹방 UI, 결제·후원·음성 방송,
읽음·typing·온라인 인원은 초기 웹 구현의 필수 범위로 추가하지 않는다.
지원되지 않는 기능은 활성 버튼이나 가짜 수치로 채우지 않는다.

## 3. 멜로밍 재사용과 vvave 참고 범위

### 선별 이식 지도

원본은 읽기 전용으로 유지한다. 경로는 `meloming-front` 기준이며, 채널 틀은 `f8907f37`,
현재 HEAD에서 삭제된 talk는 `8db1289e`를 확인했다. 이식 시 전체 SHA와 파일별 출처·권리·수정점을
작업 기록에 남긴다. [기존 조사](reference-audit.md)와 함께 의존 그래프를 검토한다.

| 원본 후보 | 가져올 것 | 로기챗에 맞춰 바꿀 것 |
|---|---|---|
| `src/features/home-new/layout/ChannelShell.tsx` | 데스크톱/모바일 채널 프레임 | 반응형이라고 children을 두 번 mount하지 않음. 채팅·socket 수명은 하나 |
| `src/domains/channel/components/channel-layout.tsx` | 프로필·배너·본문·메뉴 배치 | `/channel/:webpath` 결합 제거, 기본 채널 context 주입 |
| `src/domains/channel/components/channel/channel-menu-sidebar.tsx` | 메뉴 활성화·순서·라벨 모델 | MVP 메뉴만 사용. DnD 편집·플랜/결제 분기 제외 |
| `src/domains/channel/types/channel-tab.ts` | 기능별 메뉴 정의 | 사이트 루트 기준 경로 생성, 미래 채널 prefix는 한곳에서 처리 |
| `src/domains/channel/components/section/home.tsx` | 채널 홈의 섹션 구성 | 가격·랭킹·방송 수집 의존 제거, 후로기 공개 콘텐츠로 구성 |
| `src/domains/talk/components/room/TalkStreamerView.tsx` 등 | 타임라인·입력·개인답장 UI | 새 방을 만드는 DM 동작 대신 현재 방의 PRIVATE 명령 사용 |
| talk의 `TalkMessageList` / `TalkMessageInput` | 메시지 표현·답장 입력 상호작용 | UUID·현재 DTO·내구성 전송 큐 적용, 과거 열람 중 자동 바닥 스크롤 제거 |

원본 파일을 실제로 비교하고 재사용 가능한 부분은 옮긴다. 거대한 layout 전체를 복사하거나
새 UI를 전부 만든 뒤 “참고했다”로 끝내지 않는다. 기존 API/auth/store/socket은 그대로 이식하지 않는다.
현재 로딩된 메시지에서 만든 팬 목록을 전체 팬 목록으로 취급하지 않는다.
레거시 브랜드·로고·분석 SDK·고객지원 SDK·앱 식별자·환경 파일·운영 값은 반입하지 않는다.
제3자 코드와 자산은 라이선스·출처를 확인하고 필요한 고지를 유지한다.

### vvave에서 확인한 것과 미확인 경계

[후로기 채널](https://vvave.live/c/6766)의 공개 화면을 살펴봤다. 프로필/대표 이미지와 링크,
이용 안내, 주간·월간 일정, 옷장 분류, 검색·신청 흐름이 있는 노래책이 한 채널 아래 모인다.
“스트리머에게 필요한 기능을 모은 페이지”라는 구조를 로기챗 홈·메뉴에 반영한다.

팀에 vvave 개발자가 있고 서비스의 시작 배경도 공유하지만, 공개 화면 확인만으로 코드·API·embed
사용 계약이 확인된 것은 아니다. 후속 기능마다 **vvave가 원본인지, 로기챗이 직접 관리할지**를 먼저
정한다. 합의한 외부 링크 → 읽기 전용 API → 공동 편집 중 필요한 수준만 선택하고 이중 입력을 피한다.
이번 MVP에서 vvave 기능 전체를 복제하거나 로그인/사용자 데이터를 공유하지 않는다.

## 4. 채널과 앱 구조

### 채널 context

공개 채널 정보와 비공개 채팅방 권한을 분리한다. 현재 서버의 `creator_accounts`·`rooms`가
완성된 채널 CMS를 뜻하지는 않는다. 초기 공개 소개·메뉴는 검토된 설정 파일로 시작할 수 있지만,
인증 후 기본 방과 사용자 권한은 서버 계약에서 받는다.

- `ChannelDescriptor` 제안: 내부 채널 key, 표시명, 공개 소개/자산/링크, 활성 기능과 순서.
- 서버 bootstrap 제안: 계정 scope·이용 상태, 기본 방 binding, 내 actor·참여 scope·capabilities.
- 팬의 첫 메시지를 위해 빈 타임라인에서도 서버가 인가한 기본/허용 스트리머 recipientActorId를 제공한다.
  공개 프로필·닉네임·첫 메시지 작성자로 수신자를 추정하지 않는다. 대상이 없거나 바뀌면 송신을 중지하고 재확인한다.
- `defaultChannel` resolver가 `/` 문맥을 공급하고 각 feature는 현재 채널을 받는다.
- `channelHref(feature)`가 경로를 생성한다. 나중에 prefix를 추가해도 화면마다 URL을 고치지 않는다.
- 채널 표시명·SOOP 닉네임·클라이언트 설정으로 owner를 판정하지 않는다. 채널 관리 권한도
  private 열람 grant와 구분한다. 초기 방/owner는 권한 있는 운영 절차로 등록한다.
- 공개 홈에는 개인 메시지·비공개 참여 현황을 포함하지 않는다. 채널 선택 UI 없이도
  두 채널/방 fixture로 잘못된 context의 재사용을 검증한다.

### 웹 내부 경계 — 구현안

```text
apps/web/
  DESIGN.md
  src/app/                 # route, layout, public metadata, loading/error
  src/features/
    channel/ auth/ chat/ settings/
  src/core/
    api/ session/ storage/ sync/ outbox/
  src/shared/ui/           # Button, Dialog, Sheet 등 실제 공용 UI
  public/                  # 로기챗 자산, manifest, sw.js
```

Next.js App Router·TypeScript·Tailwind·shadcn/ui를 기본안으로 삼고, 재사용 코드와 맞는
Radix 기반 primitive부터 검토한다. 정확한 stable 버전과 호환성은 scaffold 시 다시 확인하고
lockfile에 고정한다. shadcn.io 디자인 자료와 공식 shadcn/ui 컴포넌트는 별개 출처다.
아직 존재하지 않는 생성 SDK·디자인 토큰 패키지를 구현된 의존성처럼 취급하지 않는다.
`packages/ui-web`은 실제 복수 소비자가 생기면 추출한다.

공개 홈은 Server Component 중심, 채팅·입력·브라우저 저장소·알림은 Client Component 경계로 둔다.
`View → feature model → repository → IndexedDB/REST` 방향을 유지하고 화면이 socket과
sync를 각각 새로 만들지 않게 한다. UI 선택/모달 상태와 영속 메시지 상태를 분리한다.
Query cache나 전역 store에 별도의 권위 있는 메시지 배열을 중복 보유하지 않는다.

## 5. 실제 연결 전에 확정할 계약

아래는 **제안/차단 항목**이다. [모바일 계획의 C03–C07](mobile-implementation-plan.md)과
같은 서버 변경·fixture를 공유하며 웹 전용 DTO를 별도로 늘리지 않는다.

| ID | 공백과 결정 | 완료 조건 / 차단 단계 |
|---|---|---|
| W01 | 공개 채널 descriptor와 기본 방 binding. 설정 파일/공개 endpoint 경계 결정 | 공개 필드 allowlist, 기본 방 없음/중지/변경 fixture; FW03 |
| W02 | 현재 session 응답에 계정 UUID·이용 상태·actor·참여 scope·capabilities 부족 | C03 공동 bootstrap, credential이 아닌 불투명 session binding, 명시적 입장/퇴장, 빈 대화의 인가된 스트리머 recipient; FW03/04 |
| W03 | ACK 유실 후 내 pending 메시지와 sync 메시지의 대응 | C04 본인 전용 clientMessageId projection 또는 동등한 command 조회; FW04 |
| W04 | PRIVATE 상대와 reply/publish/delete 가능 동작 | C05 projector, 방장 공개 권한과 일반 열람 grant 구분; FW04/05 |
| W05 | 화면 표시 순서와 history/delta 병합 | C06 정렬·동일 시각 tie·미로딩 과거 upsert fixture. UUID로 commit 순서 추측 금지; FW04 |
| W06 | strict DTO·오류 코드·OpenAPI·versioned sync/socket schema | C07과 공유 TS 생성/검증, absent/null/value 구분과 drift CI; 실제 연결 전 |
| W07 | 미디어·push·계정 lifecycle·신고/차단 최종 계약 | M08 사진/스티커·M09 영상·M10 삭제·M11 push, 구독 binding generation, 웹/모바일 공통 신고/차단 의미; FW06/07 |
| W08 | 현행 callback은 성공 `/`, 실패 `/auth/login`이며 임의 returnTo 입력 없음 | 고정 완료/실패 호환 route, 인증 시도 결과 binding, 탭별 복귀·취소·만료·account/link 충돌; FW03 |

W06은 연결하는 영역부터 고정한다. 전체 미디어 계약을 기다리며 홈 제작을 멈추지 않는다.
반대로 미커밋 M08 DTO를 복사해 live 기능으로 먼저 배포하지 않는다.
[NestJS 구조 보정](backend-nestjs-architecture-correction.md)의 R5까지 검증·독립 구조 리뷰·commit·CI
완료 증거를 받은 뒤 신규 Auth/DTO/projector 등 서버 기능 PR에 착수한다. 해당 모듈 경계 합의만으로
gate를 통과하지 않는다. 계약 ADR/합성 fixture 초안과 웹 독립 UI는 그동안 병행할 수 있다.
네이티브 Bearer handoff 자체는 웹 쿠키 로그인 연결의 선행 조건이 아니다.
Apple 웹 로그인 제공은 모바일과 같은 identity/link 계약이 준비된 뒤 연결한다.

W08 기본안은 서버의 웹 성공 callback을 고정된 `/auth/complete`로 연결하고 실패 경로는 호환하는
것이다. 먼저 웹에 두 route를 제공한 뒤 서버 전환을 검증한다. `soop/start`에 미구현 `returnTo`를
보내지 않는다. 웹은 인증 시작 탭에 짧은 유효기간의 복귀 의도(허용 경로·login/link 목적·시도 식별자,
link라면 시작 계정/session generation)를 저장한다. 완료 route는 현재 세션·연결 상태와 서버가
확인한 해당 인증 시도의 결과 binding을 대조하고 의도를 한 번만 소비한다. link 성공 시 같은 계정의
정상 session rotation을 허용하며 단순 `authenticated=true`를 해당 시도의 성공 증거로 삼지 않는다.
취소/만료/불일치 시 제거하고 안전한 홈/로그인으로 이동한다.
토큰·개인 본문은 복귀 저장값/URL에 넣지 않는다. 두 탭·다른 계정으로의 전환도 따로 검증한다.
결과 binding은 기존 SOOP transaction의 비밀이 아닌 결과 reference를 재사용하는 방향으로 정의한다.
reference 자체를 세션/인가 증거로 쓰거나 별도 BFF·웹 bearer·두 번째 인증 세션 계층을 만들지 않는다.
구형 서버/rollback의 성공 `/`은 홈으로 안전하게 돌아가는 호환 경로이며 자동 채팅 이동을 강제하지 않는다.

### 인증과 캐시 경계

QA 웹은 `qa.rogi.chat`, API는 `api.qa.rogi.chat`이다. API의 환경별 HttpOnly 세션 쿠키를
`Domain=qa.rogi.chat`으로 발급해 양쪽 서버에서 읽고, 브라우저의 `credentials: include` 및
정확한 Origin·CORS·CSRF 계약을 유지한다. Next 서버는 해당 환경의 쿠키만 API로 전달하고
API에서 세션·권한을 다시 검증한다. private 화면은 브라우저에서도 session/bootstrap을 확인한다.
임의 BFF 세션·localStorage bearer·존재하지 않는 refresh API를 추가하지 않는다.

로그인 callback 도착 자체를 성공으로 삼지 않고 세션·SOOP 연결·입장 상태를 재조회한다.
실제 provider가 준비되지 않으면 test/preview fixture로만 개발하며 hosted release의 mock login은 금지한다.
인증·채팅 응답은 공유 CDN/Next/RSC/SW 캐시에 저장하지 않는다. 공개 홈 캐시와 분리한다.
401, 방 접근 403, 일시적 네트워크 실패를 구분하고 모든 403을 전역 로그아웃으로 처리하지 않는다.

**로그아웃 의도와 서버 폐기 완료를 구분한다.** HttpOnly cookie 삭제와 서버 세션 폐기는 API가 수행한다.
사용자가 로그아웃하면 먼저 지속 가능한 로컬 잠금/작업 generation을 갱신하고 본문·큐·초안을 정리한다.
revoke 성공 또는 해당 세션의 만료를 확인한 뒤 서버 로그아웃 완료로 표시한다. 오프라인/응답 유실이면
`logoutPending`으로 유지해 새로고침·다른 탭 복귀에서도 기존 cookie의 세션을 자동 복원하지 않는다.
복귀 시 같은 세션인지 확인한 후 revoke를 재시도한다. 오래된 작업이 새 로그인 세션을 revoke하지 않도록
W02의 불투명 session binding과 요청 시점의 CSRF를 검증한다. 재시도 CSRF는 원래 대상 세션에
묶인 것만 사용하며 새 세션의 CSRF로 교체해 retry하지 않는다. 복구에 토큰을 localStorage에 저장하지 않는다.
새 로그인은 명시적 사용자 동작으로 시작하며 미확정 로그아웃 잠금을 무심코 해제하지 않는다.

## 6. 채팅·복구·브라우저 수명

### 영속 상태와 동기화

IndexedDB를 브라우저 내 데이터·전송 큐 저장소로 사용한다. 실제 adapter/라이브러리는 FW04에서
transaction·migration·Safari 동작을 검증해 고른다. 환경/계정, 방/참여 scope, cache generation을
분리하고 DTO→모델 변환을 repository가 소유한다. deviceId와 계정 manifest·방 timeline·방 profile의
cacheId를 구분한다. 한 방 snapshot/events/history는 같은 timeline cacheId를 쓰며 서버 binding을 검증한다.

- cold start는 세션·현재 방 인가 확인 전 private 본문을 표시하지 않는다. 저장소는 인가 증거가 아니다.
- `visibilitychange`/`pagehide`에서 민감 화면을 가리는 처리를 준비하고 `pageshow.persisted` 및
  동결/백그라운드 복귀에서는 현재 계정·참여 scope 재확인 후 화면/송신을 재개한다. 복귀한 탭이
  BroadcastChannel 알림을 받았다고 가정하지 않는다. OS가 이미 캡처한 화면의 소급 회수는 보장하지 않는다.
- message effects와 event cursor는 한 transaction으로 반영한다. history cursor는 event cursor를 바꾸지 않는다.
- 계정/프로필 manifest는 같은 generation의 모든 페이지를 받은 뒤 교체한다. 중간 페이지로 항목을 삭제하지 않는다.
- 완전한 manifest에서 사라진 방·변경된 참여 scope·축소된 capability를 대조한다. 해당 room 작업
  generation부터 무효화하고 화면/송신/관찰을 중지한 뒤 cache를 정리한다. 철회·참여 변경이면
  초안/큐도 폐기하고, capability 축소면 재인가·rebuild 후 더 이상 허용되지 않는 명령을 제거한다.
  같은 roomId 재입장도 새 scope이며 늦은 ACK/history/media가 이전 작업을 되살리지 못한다.
- snapshot/reset은 새 generation으로 재구축한다. 늦은 요청·이전 페이지가 삭제된 데이터를 되살리지 못하게 한다.
- resource version은 큰 십진 문자열로 비교하고 tombstone을 우선한다. 화면 정렬은 W05 계약을 따른다.
- 모르는 필수 sync event/schema는 적용·cursor 전진을 중지하고 업데이트 필요 상태로 처리한다.
  모르는 메시지 콘텐츠는 안전한 placeholder로 표시하며 무한 reset/retry로 덮지 않는다.
- Socket.IO 서버는 API host의 path `/v1/realtime`, transport는 `websocket` 전용, 기본 namespace다
  (2026-09-20 FW01 리뷰에서 커밋된 `apps/api/src/modules/realtime/realtime.gateway.ts` 기준으로 정정. `/socket.io` path 아님).
  socket의 `sync.required`는 재조회 힌트이며 메시지 본문/커서의 원본이 아니다.
- foreground 진입·온라인 복귀·socket 재접속에 sync한다. M06의 foreground 15초+jitter와
  socket 실패 시 3–5초 fallback, 힌트 병합 규칙을 따른다. 숨긴 탭의 영구 연결에 의존하지 않는다.
- 로그아웃·계정 전환·권한 회수 시 진행 요청/관찰/socket/전송을 중지하고 해당 데이터와 초안을 제거한다.
  session/cache generation을 await 뒤에도 확인하며 다른 탭에는 BroadcastChannel 등으로 무효화를 전달한다.

복수 탭은 같은 계정 저장소에 대한 sync·outbox 작업을 직렬화한다. 초기안은 계정별 coordinator
소유권과 IndexedDB lease/fence를 두고 다른 탭은 저장 결과를 구독하는 방식이다. 탭 종료·freeze·복귀 때
소유권 이전과 늦은 응답 폐기를 검증한다. 단순 BroadcastChannel 알림을 lock으로 간주하지 않는다.
복잡도가 커지면 탭별 cache 분리안을 검토하되, 큐 소유권/중복 전송 검증 없이 공유 큐를 열지 않는다.
저장 공간 부족·DB 초기화/eviction에서는 서버 snapshot으로 재구축한다. 영속 저장에 실패한
메시지를 “전송 대기 저장 완료”로 표시하지 않고 입력을 보존하며 재시도 방법을 안내한다.

DB migration은 기존 탭과 함께 검증한다. `versionchange`를 받은 구버전 writer는 송신/transaction을
정지하고 연결을 닫는다. `blocked`는 업데이트 안내로 처리하며 다른 탭을 닫을 때까지 대기한다.
JS/SW/API/DB schema 호환 범위를 FW04에서 기록하고 FW08 rollback 시험에 사용한다. 구버전이
새 schema를 읽을 수 없으면 명확히 업데이트를 요구하며 불명 outbox를 DB 초기화로 지우지 않는다.

### 오류·reset 처리 표

개별 message/recipient/media의 403/404는 리소스 비가시성일 수도 있다. 같은 session generation에서
bootstrap/방을 재인가한 뒤 처리하며, status 숫자만으로 전체 계정 또는 방의 데이터를 삭제하지 않는다.
알려진 오류 code 외 비 JSON/프록시 응답은 안전한 일반 오류로 변환하고 raw body를 표시/기록하지 않는다.

| 사건 | 화면·데이터·송신 처리 | 재개 조건 |
|---|---|---|
| 일반 네트워크 오류 | 기존 활성 화면은 연결 안내, cold start/복귀 gate는 잠금 유지 | 현재 인가 확인·sync |
| 세션 401 / SOOP_LINK_REQUIRED | 해당 계정/채팅 작업 중지·민감 cache/큐 정리, 로그인/연결 안내 | 새 인가·새 generation |
| 개별 403/404 | 해당 작업 중지 → 방 재인가. 방 유효 시 대상 초안 유지, 접근 철회 확인 시 방 scope 정리 | 대상/인용 문제 해결. 재인가 장애 시 본문·송신 잠금 |
| CSRF 거부 | 현재 session binding 대조, 같은 계정이어도 새 세션이면 이전 cursor 무효화 | 인가/CSRF 재확인 후 같은 명령의 결과 확인; 무한 반복 금지 |
| 400/409 | 자동 반복 금지, 입력/명령 충돌 안내 | 사용자의 수정 또는 결과 확인 |
| 429 / 네트워크·5xx 전송 실패 | ID/payload 보존, 서버 retry 정보 또는 제한된 backoff+jitter | 제한된 자동/수동 재시도 |

reset은 사유를 공개하지 않으므로 단순 만료로 추정하지 않는다. outbox는 조회 cache와 분리해
주차할 수 있지만 현재 계정/참여 scope를 재확인하기 전 자동 송신하지 않는다.

| reset 지점 | 무효화 범위 | 복구·큐 처리 |
|---|---|---|
| 계정 membership manifest | staging/continuation·account cacheId 교체, 계정 송신 일시 중지 | 완전한 새 manifest·열린 방 재인가 후 removed/changed scope 정리 |
| 방 snapshot/events/history | timeline generation·본문/인용/반응/미디어 파생·두 cursor, 방 송신 중지 | 새 timeline cacheId·snapshot. 주차한 명령은 현재 scope 확인 후 동일 ID/payload로 receipt 확인 |
| 방 profile manifest | profile staging/continuation/cacheId·민감 profile 표시 | 전체 replacement 후 복원. message cursor 유지; 인가 상실이면 정리 범위 확대 |
| 계정/방 인가 상실 확인 | 해당 scope의 cache뿐 아니라 초안/outbox payload까지 정리 | 재입장/재로그인해도 과거 명령 자동 부활 금지 |

### 입력과 상호작용

- 전송 전에 UUID clientMessageId와 정규화한 불변 payload를 outbox에 원자 저장한다.
  timeout/ACK 유실 재시도는 같은 ID·같은 payload를 사용한다. 다른 대상으로 고쳐 보낼 때는 새 명령이다.
  불명 명령은 먼저 결과를 확인하고 사용자가 별도로 새 명령을 만든다. 재시작한 `sending`은
  `outcomeUnknown`으로 복구한다. outbox·receipt mapping·확정 메시지 반영도 한 transaction으로 합친다.
- snapshot 밖으로 밀리거나 삭제된 pending은 W03 projection만으로 찾을 수 없다. 현재 인가가 유효하면
  동일 ID/payload를 POST replay해 receipt를 확인한다. `deleted`는 본문·낙관 표시를 제거하는 종료 상태다.
  확인 권한이 사라지면 scope 정리를 따르며 snapshot에 없다는 이유로 새 ID를 만들어 재전송하지 않는다.
- UI는 보내는 중·저장 완료·결과 확인 중·거부/재시도·삭제를 구분한다. 서버 저장은 상대방 읽음이 아니다.
- 일반 입력은 팬에게 ROOM_OWNER, 방장에게 SHARED 초안으로 시작한다. 스트리머가 메시지의 답장 버튼을 누르면
  원본 메시지와 작성자에 묶인 PRIVATE 초안을 연다. 입력창에는 답장할 작성자를
  표시하고 취소하면 전체 채팅으로 돌아간다. 수신 대상 선택 UI는 두지 않는다.
- 팬은 방장 전용으로 새 메시지를 보낸다. 스트리머는 전체 채팅을 보내거나 인가된 팬의
  메시지를 선택해 PRIVATE 답장을 보낸다. 빈 타임라인의 첫 팬 전송과 스트리머의 PRIVATE
  답장 복원까지 FW04의 최소 입력 범위다.
- 개인답장 거부 시 같은 유효 scope의 초안을 보존하고 전송을 막는다. 전체 발송으로 자동 전환하지 않는다.
- 방장은 자기 방에서 팬이 보낸 private 메시지를 선택해 전체공개할 수 있다. 별도 공개범위 고지·동의 단계를 만들지 않는다. 서버의 publication 명령을 사용하고
  `202`는 준비 중으로 표시한다. 본문을 SHARED 메시지로 재전송하지 않는다.
- 공개본은 별도 익명 projection을 사용하고 원본 ID/작성자/인용 연결을 노출하지 않는다.
  원본 삭제는 연결 공개본·첨부에도 반영한다. 콘텐츠 자체의 완전한 익명성은 보장하지 않는다.
- 반응은 본인 1개 선택/교체/해제와 집계만 표시한다. 타 팬 ID·활동 목록은 만들지 않는다.
  message version 변경 시 현재 보이는 항목 중심으로 reaction 조회를 합친다.
- history 추가 시 message ID+offset으로 읽던 위치를 유지한다. 과거 열람 중 새 메시지가 와도
  바닥으로 강제 이동하지 않는다. 한국어 IME 조합 중 Enter는 전송하지 않는다.
- 작성자 삭제는 기간 제한이 없다. 방 퇴장/재입장 후의 과거 자기 메시지 삭제 접근은
  lifecycle 계약에서 별도로 보장하며, 삭제를 위해 과거 본문 열람권을 임의로 열지 않는다.

## 7. 미디어·프로필·웹 푸시

미디어는 검증된 업로드/처리 상태를 UI에 반영하고 READY 이전에 전송 성공으로 표시하지 않는다.
팬과 스트리머 모두 사진·영상·검수된 스티커를 전송하며 방별 제한은 서버 계약으로 받는다.
private R2의 60초 GET Signed URL은 열람 권한 확인 후 발급받는다. 만료되면 재인가하고,
서명 URL을 영속 메시지 모델·로그·공유 이미지 캐시에 넣지 않는다. private 첨부는 Next 공용
이미지 최적화 캐시를 경유하지 않는 전달 경로를 검증한다. 원본 삭제 시 신규 접근을 차단한다.
사진/avatar/검수 스티커는 M08, 영상 rendition/poster·codec·seek/Range는 M09의 계약과 증거에
연결한다. M09 전에는 영상 전송을 활성화하지 않는다. 60초 만료 후 재인가·재발급 시 재생 위치를
복원하고 삭제·철회된 영상은 재발급하지 않는다. 이미지 성공만으로 FW06 전체를 완료하지 않는다.

프로필은 닉네임·프로필 이미지·선택 생일 월/일을 다룬다. 생일은 기본 비공개이며
전역 공개 설정 하나가 현재와 이후 참여하는 방의 스트리머에게 적용된다. 팬에게 보이지 않는
프로필 필드를 숨기기 위해 전체 응답을 받은 뒤 CSS로 감추지 않는다.

[Web Push 기반 요구](web-push-foundation.md)는 필수다. `/sw.js`·manifest·전용 아이콘과
설치 구조는 scaffold부터 준비하고 실제 발송은 서버 구독/outbox 계약 이후 연결한다.

- 권한 요청은 알림 설정 등 사용자의 명시적 동작으로 시작한다. 거절·미지원·설치 필요를 구분한다.
- `/sw.js`는 웹 origin의 JavaScript 응답이며 로그인 redirect/HTML fallback/장기 immutable에서 제외한다.
- 초기 알림은 최소 정보와 인증 후 조회를 기본안으로 두고 이벤트별 수신 범위를 FW07에서 확정한다.
- 기본 payload에는 개인 본문·팬 식별자·Signed URL을 넣지 않는다. W07/M11에서 설치/구독별
  불투명 계정 binding generation과 SW의 내구성 있는 현재 binding을 정의한다. 수신·클릭 시 대조하고
  binding이 없거나 다르면 해당 계정 내용을 조회하지 않는다. 서버도 발송 직전 권한/binding을 재확인한다.
- SW에 OAuth·인증 API·private 채팅/프로필 응답을 캐시하지 않는다. 로그아웃/전환 시 구독의 계정
  binding부터 무효화하고 서버 연결을 해제한다. 등록된 알림은 `getNotifications()`/`close()`로 정리하며
  늦은 알림 클릭은 현재 계정·방 인가 gate를 통과해야 한다. 클릭 경로는 origin allowlist로 검증한다.
  이미 OS에 표시된 내용의 소급 회수는 보장하지 않는다. 지연 push/SW 재시작의 표시 정책은
  브라우저의 user-visible 알림 조건과 함께 검증하며 구독 해제만으로 이미 전달된 알림이 취소됐다고 보지 않는다.
- QA/prod 키·구독·캐시를 분리하고 SW/API 롤백 호환성을 검증한다. iOS는 Home Screen 설치 조건을
  포함해 실기기에서 확인하며 일반 Safari 탭에도 똑같이 된다고 안내하지 않는다.

신고/차단은 [모바일 출시 조건](mobile-implementation-plan.md)과 공동 계약으로 맞춘다. FW07에는
웹의 최소 신고/지원 진입 위치·실제 처리 담당/경로·접수 결과, 차단의 대상과 효과를 정의한다.
나에게만 숨김·알림 끄기·방 접근 제한을 같은 동작으로 표시하지 않는다. 별도 운영 콘솔을 이 작업에
추가하지 않으며, 아직 연결되지 않은 요청을 성공으로 표시하지 않는다. 웹만 제외한다는 근거 없이
공통 출시 gate를 생략하지 않는다.

## 8. 실행 순서와 완료 조건

아래 순서는 의존성 기준이다. 서버/콘텐츠 준비가 불확실한 상태에서 달력 날짜를 약속하지 않는다.

| 단계 | 작업·산출물 | 완료 조건 |
|---|---|---|
| FW00 | 이식 파일/의존성 목록, DESIGN.md 기준 홈·팬/스트리머 채팅·설정 화면안 | 데스크톱/모바일, 답장 진입·메뉴·기본 채널 경계 리뷰 |
| FW01 | Next scaffold, workspace/CI 추가, ChannelShell 선별 이식, 공개 홈·route·공통 UI·SW 기반 | 타입/린트/build, deep link, 모바일 폭/키보드/접근성 확인. 모든 배포에서 preview 경로·데이터 없음 |
| FW02 | W01–W06/W08 ADR·OpenAPI·공통 JSON·TS adapter | 문서/fixture 초안은 FW01과 병행. 신규 서버 기능 착수는 구조 보정 R5 완료 증거 후; 계약/회귀/모바일 parity |
| FW03 | 실제 웹 인증·SOOP·callback/복귀·bootstrap·명시적 입장/퇴장·로그아웃 | 실제 QA 계정, 취소/실패/두 탭·복귀, 미확정 로그아웃 잠금·서버 revoke 검증 |
| FW04 | IndexedDB/outbox, 팬 ROOM_OWNER·스트리머 SHARED 입력과 메시지 선택형 스트리머 PRIVATE 답장, 텍스트/삭제 REST, history/snapshot/delta, socket hint | 빈 대화 팬 ROOM_OWNER, 스트리머 SHARED/PRIVATE 답장, ACK 유실·reset·manifest 철회·두 탭·DB migration 복구 |
| FW05 | 메시지 선택·답장 UX·전체공개·반응 | 비공개 답장 대상 확인, 공개 준비/철회·삭제 cascade·계정/방 격리 |
| FW06 | M08 사진/avatar/스티커 + M09 영상, 프로필 편집 | 양 역할 업로드·처리 실패·삭제·생일 공개, codec·만료 seek/재생 위치 복구 |
| FW07 | M10 lifecycle·M11 Web Push, 신고/차단·복구 UI | 설치·백그라운드·계정 전환, 지연 알림/binding·삭제·실제 신고 처리 경로 검증 |
| FW08 | QA 배포·운영 가능한 출시 후보 판정 | 독립 web digest·공개 경로·running release, JS/SW/API/DB rollback 호환, 공통 M12 gate·알려진 제한 |

FW03은 W01/W02/W06/W08과 실제 인증 제공자 검증에 의존한다. FW04는 W03–W05가 필요하다.
FW06은 W07의 M08/M09, FW07은 M10/M11·신고/차단의 공통 출시 계약과 완료 증거를 받는다.
홈·디자인 작업은 이 블로커들과 분리해 진행한다.
후속 일정/노래책/옷장 메뉴는 vvave 원천·권리·운영 방법 결정 후 별도 단계로 추가한다.

### 검증과 배포

- 공통 합성 fixture: 팬 2명·스트리머 2명·일반 관리자·방 2개. 다른 팬/방의 본문·존재·프로필이
  노출되지 않으며 방장 공개 capability가 일반 private 열람 grant와 혼동되지 않아야 한다.
- 실제 브라우저 시험: 새로고침/탭 종료, IndexedDB transaction/eviction, ACK 유실, 늦은 history와
  tombstone 경쟁, 재입장 scope 교체, 복수 탭 로그아웃·오래된 요청/알림 도착.
- 필수 복구 사례: 개별 404의 상대 퇴장/인용 삭제/본인 퇴장, 재인가 중 계정 전환,
  complete manifest에서 열린 방 제거/같은 roomId의 새 참여 scope, profile-only reset,
  `commit → ACK 유실 → 다른 기기 삭제 → 재시작 → 같은 명령 replay → deleted receipt`.
- 브라우저 수명 사례: bfcache 뒤로 가기·동결 탭에서 다른 계정으로 복귀, logout 요청 미도달/응답 유실
  뒤 새로고침, 표시된 알림·지연 push·SW 재시작, 이전 DB writer가 열린 채 업데이트/rollback.
- UI 시험: 작은 모바일 화면·데스크톱, iOS Safari/Android Chrome, 한국어 IME,
  키보드·safe area·스크롤 anchor, 키보드 탐색·스크린리더·확대·대비·reduced motion.
  스크린리더는 신규 수신/입력 대상/전송 오류를 알리고 history/reset 전체를 재낭독하지 않는지 확인한다.
- 계약/저장/인가 경계에 집중한 테스트를 두고 단순 스타일 변경마다 구현을 복제하는 테스트를 만들지 않는다.
  합성 fixture 통과와 실제 provider·기기·QA 왕복 성공을 별도 증거로 남긴다.
  공개 CI는 합성 계정만 사용한다. 실제 계정 본문·알림·화면·브라우저 trace는 private 위치에 두며
  공개 리뷰/CI artifact에는 비민감 결과만 남긴다. 로그에 본문·토큰·Signed URL을 포함하지 않는다.
- 웹 CI는 린트·타입·필요한 단위/브라우저 테스트·production build를 실행한다. 기존 backend·security·infra
  검증을 유지하고 Actions는 SHA 고정, 공개 PR에는 cloud credential을 주지 않는다.
- 배포 이미지는 web 전용 digest로 만들고 Next standalone의 monorepo tracing·static/public 자산을 검사한다.
  Caddy의 API/socket 경로를 보존하며 웹 deep link·`/sw.js`·health를 확인한다.
- 최신 `qa`에서 task branch에 검증·커밋·push하고 PR의 필수 검사를 확인한 뒤 정상 머지한다. 실제 배포는 기존 운영 절차로 실행하고 running digest와
  공개 경로 확인 후에만 배포 완료라 한다. `main` 운영 승격은 별도 리뷰다.

## 9. 다음 착수 시 닫을 항목

이미 확정한 “후로기 전용 루트·멜로밍 틀 재사용·Airbnb 스타일”을 다시 선택하지 않는다.
FW00에서는 위 기준으로 화면을 구체화하고, 다음 사실/계약만 확보한다.

1. 사용 가능한 후로기 프로필/대표 이미지·공식 링크·소개·이용 안내의 최종 콘텐츠와 권리.
2. W01 공개 설정과 서버 기본 방 binding, W02–W06/W08 담당 계약의 확정본·구조 보정 완료 증거.
3. 홈에서 일정 등 보조 콘텐츠를 실제로 제공할 시점과 vvave를 원본으로 사용할 범위.
4. Web Push 이벤트/계정 binding·계정 lifecycle·신고/차단의 공통 출시 계약과 연결 증거.

근거: [기반 설계](architecture.md), [재사용 조사](reference-audit.md),
[모바일 구현 계획](mobile-implementation-plan.md), [백엔드 실행 단계](backend-mvp-execution-plan.md),
[Next 서버/클라이언트 경계](https://nextjs.org/docs/app/getting-started/server-and-client-components),
[IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API),
[shadcn/ui Next 설치](https://ui.shadcn.com/docs/installation/next).

### FW04 후속 v2 소스 작업 — 배포 차단

[명령·sync v2 소스 보고서](web-command-sync-v2.md)는 명시적 메모리 SEND 기록,
C04 조회, C05 counterpart/actions, C06 M/A·schema 2와 tombstone fencing을 다룬다.
IndexedDB·프로세스 재시작 복구 완료를 뜻하지 않는다. 운영 schema 1과 호환되지
않으므로 backend 2 + web/native 동시 전환 및 짝지은 rollback 검증 전에는 배포하지 않는다.
