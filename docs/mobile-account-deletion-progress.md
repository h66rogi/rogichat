# 계정 탈퇴 접수 구현과 검증 경계

2026-09-20. [검토된 계획](mobile-account-deletion-plan.md)에 따라 양 OS의 실제 세션·보호
저장소·설정에 탈퇴 접수를 구현했다. Android 동결 소스는
`db6bddd908b7c2d8b87465ff9f58da7e9dfa630b`, iOS는
`dde2ca2e016a7d707eaec06fdc7bdc2946124257`이다. 실제 사용자 탈퇴나 배포 완료 기록은 아니다.
이 변경만을 위한 별도 테스트 배포는 만들지 않고 실제 대화 흐름과 함께 검증·배포한다.

## 제품 동작

원본 계정과 확인창의 세대를 고정하고 `DELETE /v1/me/account`에 `{}`를 한 번 전송한다.
strict 200 `blocked`와 UUID v4/v5 접수 번호만 접수 확인으로 처리한다. timeout·유실·503은
결과 불명이며 자동 재전송하지 않는다. 정확한 `RECENT_AUTH_REQUIRED`만 실제 재인증으로
이어진다. 접수·계정 이용 차단과 물리 삭제 완료를 구분하며 서버에 없는 상태 조회 API를
추가하지 않는다.

전송 전 보호 admission과 원래 DB 정리가 성공해야 한다. 화면 종료와 별개로 세션 계층이
요청을 소유하고, 앱 재실행은 남은 로컬 정리만 수행한다. ACK/UNKNOWN 기록은 최대 16개를
자동 퇴거 없이 보존한다. Android는 기존 Keystore/AtomicFile 기반의 별도 journal v1,
iOS는 기존 Keychain envelope의 schema 3을 사용한다. 새 SDK나 서버 필드를 추가하지 않는다.

결과 표시를 닫는 동작은 보호 기록을 지우지 않는다. 새 계정에는 이전 계정의 접수 번호나
재인증 동작을 노출하지 않는다. 로컬 초기화·로그아웃 확인창도 원래 세션 identity를 검사하며,
초기화 중 돌아온 인증 callback이 다른 계정을 설치하지 못하게 한다. 서버 결과를 관측한 뒤
저장소 읽기·정리가 실패해도 이를 미전송으로 바꾸지 않는다.

## 재사용과 독립 리뷰

Meloming의 설정 내 탈퇴 위치, native destructive/cancel 확인, 진행·오류 표현과 이미 추출한
HTTP·보호 credential·인증 proof·DB 정리 경계를 확장했다. 원본 탈퇴는 웹 화면 진입이므로
native 접수 journal과 coordinator를 원본에서 이식했다고 집계하지 않는다.
[재사용 기록 R47–R49](mobile-reuse-audit.md)에 실제 출처와 신규 책임을 구분한다.

독립 소스 리뷰는 strict body/UUID, crash phase, 제한 용량, 늦은 계정 응답, ACK 보존,
로컬 정리 재시도와 원래 확인창의 수명을 점검했다. 발견한 교차 계정 초기화와 iOS reset 중
callback 경계는 동결 소스에 반영했다. 소스 리뷰에서 남은 P1/P2가 없다는 판정은 실제 플랫폼
저장소·제공자·서버 배포 시험을 대체하지 않는다.

## 실행 증거와 남은 검증

| 대상 | 확인한 결과 | 남은 범위 |
|---|---|---|
| iOS 최종 동결 소스 | strict Swift 6 실행 여덟 묶음, 실제 GRDB on-disk 16개, QA/Prod Debug/Release 기기 SDK 네 구성과 제품 패키지 검사 통과. reset 중 cold callback과 오래된 초기화 확인 회귀 포함 | 실제 격리 iOS 앱 Keychain 실행 |
| Android 최종 동결 소스 | QA/Prod Debug/Release 네 구성의 JVM 테스트·lint·빌드 및 실제 APK 설정 검사 통과 | 원격 로그에 개별 JVM 테스트 총수는 출력되지 않아 예상 개수를 실행 개수로 표기하지 않음 |
| Android 실제 저장소 | credential/pending/Room/deletion을 포함한 실제 Keystore·SQLite 계측 19개를 격리된 hosted API 36 인스턴스에서 실행, 실패·skip 0 | 실제 사용자 인증과 기기 간 왕복 |
| 제품·배포 | 양 OS security/commit/push, 도구 테스트 108개와 원격 필수 검사 통과. CI 임시 키 Android APK/AAB 검증 포함 | 실제 배포용 서명·업로드는 실제 대화 기능 묶음에서 수행 |

부모 통합 SHA `8216b8f35b45a1ab1a2e3c1b570a42a17b5178fe`의
[원격 실행 35504846246](https://github.com/h66rogi/rogichat/actions/runs/35504846246)이
모두 성공했다. 이 기록은 동결된 계정 삭제 구현에 대한 증거이며 이후 작성 중인 대화 구현의
검증 결과로 재사용하지 않는다. CI의 disposable signing keychain 검사는 앱 Keychain 검사와
별개다.

iOS host 시험은 명시적으로 주입한 격리 ByteStore와 실제 marker 파일/GRDB를 사용한다.
실제 QA Keychain이나 사용자 계정에는 접근하지 않았고, 이를 iOS Keychain 실행 증거로
표시하지 않는다. 자동 테스트의 합성 계정·응답은 제품 구성에 포함하지 않는다.

실제 접수에는 원장·전용 guard와 제공자·네이티브 인증 API의 QA 활성화가 필요하다. 물리 삭제,
미디어·백업 보관 및 공개 개인정보 안내는 서버 운영 계약에 따라 별도 확인한다. 사용자가
현재 직접 SOOP 로그인을 할 수 없는 사실은 실계정 왕복 증거의 제약으로 남기고 독립적인
제품 구현·검증·배포를 계속한다.
