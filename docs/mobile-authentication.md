# Apple 로그인과 SOOP 필수 계정 연결

2026-09-20 사용자 결정: Apple 로그인을 제공하되, Apple로 로그인해도 SOOP 계정을
연결해야 채팅 서비스를 이용한다. 아래 인증·인가 계약은 구현 전 설계다.
이 문서는 기존 [SOOP 인증 중계](soop-authentication.md)에 Apple 진입과 이용 gate를 추가한다.

## 계정 상태와 이용 범위

로그인 수단과 SOOP 연결 자격을 분리한다. user UUID가 계정의 주체이며 Apple/SOOP는
검증된 identity다. SOOP 연결은 스트리머 역할을 부여하지 않는다.

| 상태 | 허용 | 제한 |
|---|---|---|
| 미로그인 | 로그인·정책 안내 | 개인 계정과 채팅 |
| 로그인, SOOP 미연결 | 내 계정·연결 안내/시작·로그아웃·탈퇴·지원·약관 | 방 입장/조회·전송·sync·미디어·반응·채팅 push 등록 |
| 로그인, SOOP 연결 유효 | 방 역할/현재 권한에 따른 기능 | 타 방·타 팬 정보, 별도 스트리머/운영자 권한 |
| SOOP 연결 철회/재검증 필요 | 계정 관리·재연결 | 새 채팅 접근과 미디어 URL 발급 |
| 계정 정지/탈퇴 | 정해진 계정 종료/지원 흐름 | 모든 일반 서비스 접근 |

`GET /me` 제안 응답은 `onboardingState`, `soopLinkStatus`, 필요한 capabilities를 포함한다.
미연결은 로그인 실패/401과 구분해 `403 SOOP_LINK_REQUIRED`로 표현한다. refresh로
무한 재시도하거나 계정을 새로 만들지 않는다. gate는 UI뿐 아니라 REST·socket 인증·sync·
파일 intent/조회·push worker에 동일하게 적용한다. 기능 플래그를 인증 gate로 사용하지 않는다.

SOOP 연결 안내에는 연결 목적·처리 데이터와 취소/나중에 하기·로그아웃·탈퇴를 제공한다.
취소 시 제한 계정이 유지된다. 연결 완료 후 일반 로그인마다 SOOP 인증을 반복하지 않는다.
SOOP access token의 단순 만료를 identity 철회와 동일시하지 않는다. 철회/보안 사건/명시적
재연결 정책 때 재검증을 요구하며 broker 장애와 이미 검증된 연결 상태를 구별한다.

## 로그인·연결 흐름

1. iOS는 native Sign in with Apple을 사용한다. Android/web에도 같은 계정 접근이
   가능하도록 Apple web 인증 경로와 Services ID 구성을 함께 계획한다.
2. 서버가 검증한 Apple identity가 없으면 약관 동의 후 제한 계정을 생성한다. 기존 identity면
   같은 user로 로그인한다. 이름/이메일 재수신을 매 로그인 조건으로 요구하지 않는다.
3. 미연결이면 SOOP 연결 안내로 이동한다. 기존 broker의 `intent=link` transaction에
   로그인한 user·session·환경·nonce/일회용 code·앱 S256 challenge를 결합한다.
4. 검증된 SOOP canonical subject를 현재 계정에 원자적으로 연결한다. 사용자 상태와
   transaction 유효성을 다시 확인하고 권한 generation을 갱신한 뒤 `/me`를 재조회한다.
5. 이미 SOOP 연결이 있는 계정은 Apple 로그인만으로 정상 이용한다. 기존 SOOP 직접
   로그인 진입도 유지하며 같은 user UUID로 귀결한다.

앱 callback에는 일회용 completion code만 전달한다. access/refresh token이나 SOOP
identity를 URL query에 넣지 않는다. API broker callback 경로를 앱 링크로 가로채지 않는다.

## identity·충돌·세션

- Apple identity 제안: `auth_identities(provider, issuer, subject, user_id, status)`.
  검증한 provider/issuer/subject는 유일하며, 이메일·private relay 주소·이름으로 자동 병합하지 않는다.
- SOOP 연결은 기존 `platform_soop`의 subject unique·user unique와 검증 기록을 사용한다.
  동일 연결을 별도 테이블에 이중 원본으로 만들지 않는다.
- 이미 다른 계정에 연결된 SOOP이면 자동 이전/병합하지 않는다. 기존 SOOP 계정에 로그인한 뒤
  설정에서 Apple 연결을 진행하는 명시적 복구 흐름을 제공한다. Apple identity가 이미 제한 계정에
  연결돼 있어도 재할당은 양쪽 계정의 최근 인증과 별도 검토된 연결 이전 계약 없이는 거부한다.
  초기에는 자동 merge를 구현하지 않고 계정 관리에서 안전하게 해결한다.
- link 의도와 login 의도를 구분한다. user/session 교체·로그아웃·탈퇴 후 늦은 callback은
  거부한다. 동시 link는 DB unique와 transaction으로 한 계정만 성공하도록 한다.
- SOOP 연결 해제/철회는 권한 generation과 기존 세션 capability를 무효화하고 기기의
  채팅 cache·pending command·push 연결을 정리한다. 재연결 후 과거 membership 복원 범위는
  서버 정책으로 재계산하며 앱이 이전 권한을 되살리지 않는다.
- Apple 연동 해제/계정 삭제 알림은 진위를 검증하고 해당 identity와 세션을 정책대로 폐기한다.
  다른 인증 수단이 남아 있는 계정의 삭제 여부를 Apple 이벤트 하나로 임의 결정하지 않는다.
- 로기챗 탈퇴는 provider token 폐기와 로기챗 데이터 삭제 흐름을 함께 수행한다. 다른 세션에서
  확정한 메시지·공개본·첨부 삭제 정책과 연결한다.

## Apple 검증과 운영 등록

서버에서 Apple 서명/JWKS, 허용 issuer, 환경·native/web client별 audience, 만료,
nonce, authorization code와 transaction binding/replay를 검증한다. JWT decode만으로
로그인시키지 않는다. Apple subject의 앱 그룹 범위는 실제 primary App ID/Services ID
구성으로 검증하며 다른 client의 subject가 자동으로 같다고 가정하지 않는다.

Apple App ID capability·Services ID·return URL·QA/prod client allowlist·서버용 signing key
등록이 필요하다. 사용자 동의는 기능 채택 승인이고 개발자 포털 등록이 이미 완료됐다는
의미는 아니다. `.p8`, client secret, refresh token, provisioning을 공개 Git·이미지·로그에
넣지 않는다. 웹/Android도 같은 서버 계정 계약과 one-time completion을 사용한다.

참고: [Apple identity 검증](https://developer.apple.com/documentation/signinwithapple/verifying-a-user),
[계정 변경 알림](https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts),
[web Services ID](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web).

## 출시 판단과 시험

Apple 로그인 추가만으로 심사 통과를 보장하지 않는다. 로그인 후 SOOP 연결을 강제하는
구조가 4.8의 동등한 로그인 선택지로 인정되는지는 별도 검토 대상이다. SOOP 연결이
채팅 서비스에 필요한 실제 이유·사용 데이터·미연결 이용 범위를 정리하고 심사 설명에
투명하게 제시한다. 버튼 이름 변경이나 심사용 gate 우회로 해결하지 않는다.
정책 변경이 필요하면 제품 결정을 재검토한다.
[App Review Guidelines 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services).

필수 시험:

- Apple 신규/기존 사용자, 이름/이메일 누락, private relay, 환경별 audience 불일치.
- Apple 로그인 성공 후 SOOP 취소·거절·timeout·다른 계정 충돌·동시 연결.
- code/state/nonce replay, 다른 앱/환경/verifier 교환, link 중 로그아웃·계정 변경.
- SOOP 미연결 계정의 직접 REST/socket/sync/media 호출 거부, 계정 관리·탈퇴는 접근 가능.
- 연결 이후 Apple만으로 재로그인, SOOP broker 단절과 기존 세션 정책.
- 연결 철회 중 열린 앱/다운로드 발급/다른 기기/대기 전송/push, 재연결 후 권한 재검사.
- Android/iOS/web에서 동일 user로 접근하고 provider ID·token을 DTO/로그에 노출하지 않음.
