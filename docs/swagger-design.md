# 로기챗 Swagger / OpenAPI 설계와 구현계획

상태: 승인된 설계와 리뷰를 구현에 반영 · 2026-09-20 · QA 배포 검증은 PR 완료 조건이다.
최초 검토: QA `8aa0ccaf03e61fe52c6e5c9b9ec138ba20a3b05c`. 리뷰 시 QA `8ece99d`, 구현 시 QA `84e1538`의 네이티브 인증·수신자 계약을 반영했다.

## 목적과 범위

웹·Android·iOS가 동일한 REST 요청, 응답, 오류와 인가 조건을 확인할 수 있게 한다.
첫 적용은 **QA Swagger UI와 OpenAPI JSON, 실제 계약에 맞는 스키마 및 검증**이다.
별도 문서 서버, SDK 자동 생성, DB 변경, 인증 방식 변경은 포함하지 않는다.
Swagger를 제품 화면이나 운영자 콘솔로 사용하지 않는다.
소켓 알림은 REST 작업이 아니므로 기존 sync/socket 계약으로 연결하며 REST endpoint로 꾸미지 않는다.

## 조사 결과

| 근거 | 확인 내용 | 적용 판단 |
|---|---|---|
| `meloming-back` @ `57a4c76bc763b20cbf2bb0a8a0ebcf61aff4383a`, `src/main.ts` | DocumentBuilder와 SwaggerModule 연결, production에서 미등록, Bearer 인증 | 연결 패턴 참고. 환경 판별과 인증 설정은 로기챗 계약으로 작성 |
| 같은 저장소 `src/category/category.controller.ts`, `src/category/dto/category.response.dto.ts` | 작업 설명·파라미터·응답 DTO·nullable 명시, 응답 mapper 사용 | 컨트롤러 가까이에 계약을 두고 공개 응답만 문서화하는 방식 참고 |
| `meloming-commission-back` @ `6822e95ff8581d15ffe9f410599496e0634b88bf`, `src/main.ts` | 사용자/관리자 문서 분리, operationId, 검색·접기, 인증 저장 | 작은 서비스에는 단일 문서와 태그로 충분. 경로 문자열 사후 필터, 외부 자산, 인증 저장은 가져오지 않음 |
| 로기챗 `application.ts`, `app.module.ts`, `infrastructure/config/runtime-settings.ts` | Nest 12/Express 5, 직접 요청 파싱, 동적 모듈, Helmet, 기능 구성에 따른 route 등록 | 실제 등록된 route를 생성 원본으로 사용. worker에는 문서 초기화 없음 |
| 로기챗 `auth-context.ts`, `auth-cors.ts`, `test/e2e/http.test.mjs` | 쿠키 세션과 쓰기 요청의 Origin/CSRF 검사, `/docs` 404 시험 | 기존 인증 정책 보존. 환경별 문서 노출 시험으로 변경 |

참조 저장소는 읽기만 했다. 위 기록은 구현 참고이며 소스를 복사·재사용했다는 의미가 아니다.
브랜드·계정·내부 주소·운영 설정·Talk/TalkV2 구현은 반입하지 않는다.
Context7 `/nestjs/docs.nestjs.com`에서 setup, 명시적 schema, cookie security,
raw JSON 및 operationId 설정을 확인했다. 예제는 설치 버전의 타입·실행 결과로 다시 검증한다.

## 설계 결정

### 문서 제공과 인증

- API 프로세스에서 `/docs` 및 `/docs/openapi.json`을 제공한다. UI 제목은 `로기챗 API`.
  `Config.environment`가 `qa` 또는 `local`일 때 활성화한다. `test`는 기본 미노출로 두고
  문서 시험에서만 같은 구성 함수를 명시적으로 호출한다. production에서는 UI·JSON·YAML·정적 자산 경로를 모두 등록하지 않는다.
  판별은 기존 `Config.environment`를 사용한다. 이미지의 `NODE_ENV=production`을 QA 판별에 쓰지 않는다.
- QA 문서는 익명 조회 가능한 개발 계약으로 취급한다. 실제 계정·메시지·미디어 URL·토큰은 포함하지 않는다.
  관리자 REST도 단일 문서에 별도 태그와 권한 조건을 표시한다. 문서 노출이 실행 권한을 부여하지 않는다.
  private broker/decoder/운영 endpoint는 대상에서 제외한다.
- 첫 적용에서는 `swaggerOptions.supportedSubmitMethods: []`로 **Try it out을 비활성화**한다.
  `tryItOutEnabled: false`만으로 실행을 막았다고 간주하지 않는다. 인증 저장은 끄고,
  외부 validator·CDN·외부 favicon을 사용하지 않는다. 검색·태그 접기·deep link만 제공한다.
- 쿠키 인증과 보호된 쓰기 요청의 CSRF 헤더·허용 Origin을 문서화한다. 쿠키와 CSRF는
  해당 요청에서 동시에 필요한 조건이다. security requirement를 OR로 잘못 표현하지 않는다.
  인증 조건은 작업별로 지정한다. health에는 인증이 없고 SOOP start의 login/link는 조건이 다르다.
  login 시작에 기존 세션을 요구하거나 callback에 일반 쓰기 인증을 일괄 적용하지 않는다.
  QA에 병합된 네이티브 인증은 Bearer opaque 토큰과 `X-Rogi-Client`의 AND 조건으로 표시하며,
  웹 쿠키(+쓰기 CSRF) 방식과는 OR 관계다. Origin은 웹 쓰기에서만 필수다. 두 방식의 혼용은 거부한다.
  네이티브 세션 응답은 웹 응답과 oneOf로 분리한다. 아직 없는 네이티브 공개 로그인·refresh 경로는 만들지 않는다.
- 브라우저는 임의 Cookie/Origin 헤더 설정에 제한이 있고 현재 API 호스트의 문서 Origin은
  웹 앱의 허용 Origin과 다를 수 있다. 실행 기능을 위해 CORS/CSRF 허용 범위를 넓히지 않는다.
  후속 실행 지원은 확정된 인증 계약, 실제 로그인 흐름, 허용 문서 origin을 함께 검증하는 별도 작업이다.
- Helmet은 유지한다. UI HTML/JS/CSS를 실제 브라우저에서 확인하고 필요하면 문서 경로에만
  최소 CSP를 적용한다. 전역 CSP 비활성화나 임의 외부 script 허용은 하지 않는다.

### 계약 생성과 서비스 의미

- `@nestjs/swagger`는 현재 Nest 12와 peer dependency가 맞는 버전을 확인해 정확히 고정한다.
  기존 `tsc` 빌드를 유지하고 Swagger CLI plugin을 위해 빌드 체계를 교체하지 않는다.
- 문서 초기화는 `infrastructure/openapi/`에 분리하고 `createConfiguredApi`에 연결한다.
  스키마는 각 기능의 `dto/*.openapi.ts`에 두고 컨트롤러에 `ApiTags`, `ApiOperation`,
  `ApiBody`, `ApiParam/Query`, `ApiResponse`를 명시한다. 공통 오류 등만 공유한다.
  interface와 `@Req()`에서 body 타입이 자동 추론된다고 가정하지 않는다.
  DTO class 전환이나 기존 parser/validator 교체 없이 문서 메타데이터를 추가한다.
- 실제 메서드·경로에서 자동 수집하며 operationId는 작업별 명시적 고유 이름으로 고정한다.
  수동으로 별도 paths 목록을 유지하지 않는다. 누락 방지는 route inventory와 생성 결과 비교로 확인한다.
- 첫 배포에 등록된 모든 공개 HTTP 컨트롤러를 포함한다: health, auth,
  users, rooms, messages, sync, reactions, publications, 활성화된 media/stickers. FAN 방의 `private-recipients`와 현재 권한·50개 페이지 조건을 포함한다.
  현재 별도 terms/account 컨트롤러는 없다. 약관 동의는 기존 auth 요청으로 설명하며,
  계정 관련 신규 endpoint는 QA에 실제 등록된 뒤 포함한다.
  동적 기능이 비활성 상태라면 실행 중인 문서에 해당 route가 나타나지 않아야 한다.
- 응답은 Prisma 모델이 아니라 viewer별 공개 projection을 기준으로 명시한다.
  생일 비공개 조건, 팬 비공개 메시지와 스트리머 열람 범위, 관리자에게 없는 대화 권한,
  익명 공개본에서 제거되는 식별 정보, 원본 삭제 시 공개본·첨부 접근 회수를 설명한다.
- 요청의 생략과 null을 구분한다. 예: SHARED 발송은 `recipientActorId`를 **생략**해야 하며
  내부 `SendInput`의 정규화 결과인 null을 요청 예제로 쓰면 현재 parser에서 거부된다.
  TEXT/PHOTO/VIDEO/STICKER는 `oneOf`로 표현하고 개수·필수 필드·금지 조합을 기록한다.
  최신 QA에서 STICKER는 `stickerId`, PHOTO/VIDEO는 `assetIds`를 사용한다. 이전 스티커 assetIds 예제는 허용하지 않는다.
  요청/응답 schema는 분리한다. STICKER 응답에는 공개 projection의 `assetId`·크기 등이 추가된다.
  요청의 각 oneOf 분기에 허용 필드·required·`additionalProperties: false`를 명시해
  알 수 없는 속성과 다른 content 종류의 필드를 거부하는 parser 동작을 반영한다.
- `clientMessageId` 재시도/멱등성, cursor와 재동기화, 200 저장 완료와 상대 전달·읽음의 차이,
  publication 202와 후속 처리, leave 204의 빈 body를 실제 구현에 맞춰 기술한다.
  오류는 `{ error: { code } }` 형태와 endpoint별 실제 상태코드로 작성한다.
  ACL에 따른 404와 입력 오류, 일시적 503을 성공 응답으로 통합하지 않는다.
  `@Res()`를 사용하는 auth의 303 redirect·Location·Set-Cookie·204는 수동 명시한다.
  미디어 content 업로드는 JSON/multipart가 아닌 `application/octet-stream` binary body이며,
  Content-Length는 선택 사항이며 제공 시 예약한 크기와 일치해야 한다. 실제 전송 바이트 수와 encoding 제한 및 202 응답을 명시한다.
- 스키마에 담기 어려운 바이트 길이·정규화·교차 필드 조건은 설명과 기존 계약 시험으로 보완한다.
  예시는 테스트 전용 합성 값으로 작성하며 실제 운영 응답을 캡처해 공개하지 않는다.

### 생성 산출물과 검증

실행 중 문서는 실제 Nest 모듈 구성을 반영한다. CI export는 동일 feature graph에 테스트 전용
provider override를 사용해 DB·broker·storage·socket background 작업 없이 메타데이터만 생성한다.
운영 bootstrap/config reader는 호출하지 않고 합성 설정으로 동일 `AppModule.register`를 구성한다.
`NestFactory.create` → `SwaggerModule.createDocument` → `finally app.close` 순서로 구성하며,
export에서는 `app.init`, `listen`, `createApplicationContext`를 호출하지 않는다.
`RealtimeGateway.onApplicationBootstrap`가 소켓과 job timer를 시작하기 때문이다.
전체 기능 fixture에는 `database.transactions`와 auth/media 주입값이 필요하다.
health 시험의 최소 DB stub만 재사용하면 Transactions DI가 실패한다. 테스트 전용 provider는
의도하지 않은 DB·broker·storage 작업에 즉시 실패하도록 하고, 외부 I/O 없이 export 종료를 검증한다.
별도 controller 복제본이나 가짜 성공 API를 배포하지 않는다. route inventory는
**health만 / auth 활성·media 비활성 / auth·media 활성** 세 구성을 시험한다.
소켓 transport는 HTTP route 비교 대상에서 제외한다.
정렬된 OpenAPI JSON은 build/CI artifact로 제공하고 생성 파일을 Git에 수동 관리하지 않는다.
스키마의 required/nullable/enum/oneOf를 대표 실제 응답 및 기존 parser 사례와 검증한다.
문서가 다시 자기 자신만 검사하는 snapshot 하나로 계약 일치를 주장하지 않는다.

## 구현계획과 완료 조건

| 순서 | 작업·파일 범위 | 완료 조건 |
|---|---|---|
| 1 | 최신 QA 반영, `apps/api/package.json`, lockfile, `infrastructure/openapi/`, application/config 연결 | 고정 dependency 호환·clean build 성공, QA/local만 UI와 JSON 제공, prod/worker 미노출 |
| 2 | 기능별 controller 및 `dto/*.openapi.ts`, 공통 오류 schema | 실제 route 전수 포함, 안정적 operationId, 인증·권한·입출력·오류 문서화, 신규 인증/수신자 계약 반영 |
| 3 | `test/contracts/`, `test/e2e/`, export script, API README | 세 구성 route 비교, schema 유효성·대표 응답·SHARED/null·STICKER 금지 필드 검증, `/docs` 기존 시험 갱신, 브라우저 CSP·자산·실행 비활성 확인 |
| 4 | QA 대상 PR → 필수 CI → 병합 → 기존 digest 배포 경로 | 배포 SHA와 이미지 확인, 실제 `/docs`·JSON·자산 확인, `/live`·`/ready` 및 무인증 API 거부 회귀 확인 |

문서 노출만으로 DB migration은 필요하지 않다. Caddy의 기존 API catch-all proxy를 활용하며
다른 대화의 web edge/배포 변경을 덮어쓰지 않는다. 런타임 config 변경이 필요하면 기존 private
ops 배포 경로에 반영하고 실제 적용 여부를 확인한다. production 승격은 별도 변경으로 유지한다.
실패 시 이전 검증 image/config로 되돌리고 문서 확인 실패를 완료로 보고하지 않는다.

백엔드 대화에는 중복 가능성을 사전 고지했다. 별도 체크아웃에서 작업하고 병합 전 최신 QA를
반영한다. 충돌 가능 파일은 controller/DTO, application/config, package/lock, 계약 시험이다.
이 설계 PR 시점에 완료 알림을 보내지 않는다. 구현·QA 배포·실제 검증까지 끝난 뒤 한 번 알린다.

## 리뷰 반영

서브에이전트 읽기 전용 리뷰에서 제시한 export lifecycle/DI, 중간 기능 구성, binary 업로드,
메시지 요청·응답 분리와 금지 필드 4건을 반영했다. 별도 코드 대조로 local/test 환경 정책,
로그인 인증 예외와 redirect 응답도 보완했다. 구현은 아래 검증을 포함한다. 실제 배포 상태는 PR과 원격 릴리스 증거로 확인한다.

- health/auth/full 세 구성에서 실제 REST route와 고유 operationId를 대조하고 OpenAPI 3.0 표준을 검사한다.
- 메시지 parser 및 공개 projection과 schema를 비교하며, 기존 MySQL HTTP 통합 테스트 및 네이티브 세션·비공개 수신자 응답도 schema로 검증한다.
- local/qa UI·JSON·자산 노출, test/production 404, Helmet·no-store와 실행 비활성을 검사한다.
- offline export는 lifecycle/I/O 호출 없이 종료하며 CI artifact를 생성한다.

## 근거 문서

- [서비스 요구와 권한 모델](backend-design.md), [MVP 계약 방향](backend-mvp-execution-plan.md)
- [QA 배포 경로](runbooks/qa-backend-deployment.md) — 자동배포 변경은 구현 시 최신 QA/ops를 재확인
- [Nest OpenAPI setup](https://docs.nestjs.com/openapi/introduction)
- [명시적 타입과 파라미터](https://docs.nestjs.com/openapi/types-and-parameters), [인증 정의](https://docs.nestjs.com/openapi/security)
- [Swagger UI 설정](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/)
- [Cookie 인증과 브라우저 제약](https://swagger.io/docs/specification/v3_0/authentication/cookie-authentication/)
