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
| iOS 최종 동결 소스 | 부모 통합에서 strict Swift 6 실행 여덟 묶음과 실제 GRDB on-disk 16개 통과. reset 중 cold callback과 오래된 초기화 확인 회귀 포함 | 마지막 reset 변경의 기기 SDK 증분 빌드, 실제 격리 iOS Keychain 실행 |
| Android 이전 checkpoint | QA 171개·Prod 163개 JVM, 실패/error/skip 0; QA lint와 app/androidTest 컴파일 통과 | 최종 동결 소스의 추가 회귀와 실제 ViewModel 취소·typed reset 검사 재실행. 예상 178/170은 아직 실행 결과가 아님 |
| Android 실제 저장소 | credential/pending/Room/deletion을 포함한 19개 계측을 작성·runner 준비 | 최종 앱/test APK 빌드와 소유한 격리 Android 인스턴스에서 실행. 작성·컴파일을 실행 증거로 집계하지 않음 |
| 제품·배포 | 양 OS 동결 소스의 security/commit/push 검사 통과, 원격 SHA 확인 | 통합 빌드·제품 패키지 검사·서명·배포는 실제 대화 기능 묶음에서 수행 |

iOS host 시험은 명시적으로 주입한 격리 ByteStore와 실제 marker 파일/GRDB를 사용한다.
실제 QA Keychain이나 사용자 계정에는 접근하지 않았고, 이를 iOS Keychain 실행 증거로
표시하지 않는다. 자동 테스트의 합성 계정·응답은 제품 구성에 포함하지 않는다.

실제 접수에는 원장·전용 guard와 제공자·네이티브 인증 API의 QA 활성화가 필요하다. 물리 삭제,
미디어·백업 보관 및 공개 개인정보 안내는 서버 운영 계약에 따라 별도 확인한다. 사용자가
현재 직접 SOOP 로그인을 할 수 없는 사실은 실계정 왕복 증거의 제약으로 남기고 독립적인
제품 구현·검증·배포를 계속한다.
