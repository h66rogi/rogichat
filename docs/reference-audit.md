# 기존 서비스 조사와 재사용 지도

조사일 2026-09-19. 아래는 코드와 Git 이력을 읽은 결과이며 실제 서비스 가동 여부를
의미하지 않는다. 원본 Git 이력·운영 설정·사용자 데이터는 이 저장소에 가져오지 않았다.
Android/iOS는 원격에서 별도 reference checkout을 확보했다.

## 확인한 시점과 경로

| 저장소 | 확인 기준 | 결과와 유용한 경로 |
|---|---|---|
| meloming-front | HEAD `f8907f37`; 로컬 qa `8db1289e` | HEAD에는 talk 경로 없음. qa의 `src/domains/talk/{apis,components,hooks,stores,types}`, 채널 `guestbook`이 주요 후보 |
| meloming-front-mono | HEAD `70e4d67`; qa `178c9f5` | 현재 talk 없음. 삭제 커밋 `fc24fbb` 직전 `02f5373f351ddbcf192afd5fb9e01b51232fd367`의 앱별 talk와 packages/workspace 구조 확인 |
| meloming-back | 로컬 HEAD `26b30051`; origin/main `1f484b12`; qa `b7d179a6` | `src/talk`, `src/talk-v2`, `prisma/schema.prisma` 확인. 로컬 파일과 최신 main은 같지 않으므로 이식 직전 기준 SHA 확정 필요 |
| meloming-android | main `ecb3dbe` | `feature/talk`, `core/network/socket`, `core/data/repository`, `core/model/talkv2`, 채널 방명록 |
| meloming-ios | main `18a33bb` | `Meloming/Presentation/Talk`, `TalkV2`, `Channel/Guestbook*`, `Core/Network/TalkSocketManager`, `Core/TalkV2` |

웹 talk 삭제: meloming-front `16238538`(2026-08-16).
모노 앱 정리: meloming-front-mono `fc24fbb`(2026-07-31).
현재 default branch만 보면 재사용 가능한 기능을 누락하게 된다.
다음 이식은 `git show <sha>:<path>`로 필요한 파일만 추출하고 소스 SHA를 기록한다.

## 재사용 판단

| 영역 | 재사용 후보 | 먼저 분리/검증할 것 |
|---|---|---|
| 1:N 웹 UI | `TalkStreamerView`, message bubble/list/input, 낙관적 전송 상태 | 전역 채널·결제·이모티콘 의존, 임시 ID와 ACK 동기화 |
| WebSocket | reconnect/backoff, heartbeat, connection 상태 UI | 전송 path와 namespace 구분, auth 만료·차단·재접속 누락 복구 |
| 초기 Talk | BUBBLE/GROUP, ALL/OWNER_ONLY, OWNER/ADMIN/MEMBER 타입 | 단일 스트리머로 축소, 서버 수신자 권한 검증 |
| Talk V2 | fan thread, recipient authorization, sequence, idempotency, outbox | auth/account lifecycle/cash/recording/membership 등 큰 의존 그래프 |
| 프로필·방명록 | 웹 domain API/hooks, 모바일 model/repository/view | 개인정보 응답 최소화, 이미지 업로드, 권한·페이지네이션 |
| 모노레포 | pnpm workspace, apps/packages 경계 | 앱마다 복제된 talk domain을 다시 중복 이식하지 않음 |
| Android | Compose + Hilt + Ktor, Repository/ViewModel | Kotlin/AGP/KSP/Compose 호환 세트로 갱신, 기존 signing/Firebase 제외 |
| iOS | SwiftUI, URLSession 계열 API, Socket.IO, Keychain | Swift 6 concurrency, SPM lock, 기존 team/bundle/push entitlement 제외 |

기존 고객지원 `ChannelTalk` SDK는 서비스 내 `channel talk` 기능과 이름이 비슷하나
별도 제품이다. 신규 채팅의 필수 의존성으로 옮기지 않는다.
외부 SOOP 방송 메시지 수집 시스템도 본 서비스 내 팬 메시지 시스템과 다르다.

## 발견한 기술 차이

- 웹 기존 버전은 Next 16.2.6, React 19 계열. 백엔드는 Nest 11, Prisma 6 계열.
- backend datasource는 MySQL. 별도 방송 채팅 수집 DB의 PostgreSQL 사용 여부와
  관계없이, 이번에 추출하는 Talk 모델은 MySQL 스키마를 기준으로 작성돼 있다.
- `/talk` gateway는 Redis를 직접 사용한다. V2는 socket auth·수신자 인가·outbox와
  계정 상태 변경을 별도 서비스로 나눈다. 모듈 전체 복사는 필요 없는 의존성을 끌어온다.
- Android 기준은 Kotlin 2.0.21/AGP 8.7.3, Compose BOM 2024.12.01, Ktor 3.0.2.
- iOS 기준은 deployment target 16.0, Swift language setting 5.9,
  Socket.IO Swift package 16.1.1 이상. 최신 toolchain에서 그대로 통과한다고 가정하지 않는다.

## 이식 절차

1. 원본 SHA·파일·권리/라이선스·의존 그래프를 작은 이식 단위마다 기록한다.
2. 운영 값과 불필요한 플랫폼·결제·음성·분석 SDK를 제거한 변경을 리뷰한다.
3. HTTP/소켓 계약을 먼저 정의하고 합성 fixture로 TS/Kotlin/Swift parity를 검증한다.
4. 원본 테스트의 핵심 동작을 포팅하고 PostgreSQL 대상으로 트랜잭션/동시성 테스트를 실행한다.
5. index·history·Docker context를 검사한 뒤 QA에 배포하고 실제 경로를 검증한다.

현재는 조사 완료 상태다. 앱 전체 복사, 사용자 데이터 이관, SOOP 운영 연동은 수행하지 않았다.
