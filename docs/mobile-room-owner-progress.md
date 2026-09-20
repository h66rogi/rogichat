# 방장 가입 전 팬 수신함의 모바일 연결

2026-09-21. 공개 `availability=READY`는 실제 팬의 발견·참여·읽기 가능 상태다.
서버 내부의 `owner_bound`와 구분하며, 후로기의 로그인 전에도 실제 기본방을 이용한다.
기존 QA18은 READY 방의 참여·화면 진입이 가능하지만, 수신 actor가 없는 팬 전송은
차단한다. 따라서 완전한 전송 지원에는 이번 네이티브 소비자 변경이 필요하다.

## 고정 계약

API `b5ef0b3a99ffa225eb0d5c8ea4f2fc44edba745e`의 messages DTO/service와
WEB `1d6b2f781b3db66a0aeab743fb726c6c5c724fb7`의 composer/outbox를 대조했다.

- FAN 방의 FAN 역할에서 기본 전송은 `intent=ROOM_OWNER`다. `recipientActorId`와
  `quoteId`는 보내지 않는다. UI는 가짜 프로필 없이 “방장에게만”으로 대상을 표시한다.
- TEXT·PHOTO·VIDEO·STICKER가 기존 전송 명령·서명된 미디어 준비 흐름을 공유한다.
  실제 방 미디어 정책 및 사용 권한은 계속 서버가 결정한다.
- 특정 메시지에 대한 답장은 기존 `PRIVATE`와 실제 `recipientActorId`·`quoteId`를
  유지한다. 답장 취소 후 다시 방장 수신함으로 돌아간다.
- GROUP/MEMBER 및 FAN/STREAMER는 ROOM_OWNER 명령을 로컬 승인하지 않는다.
  FAN의 SHARED 금지, 보호된 account/membership/authorization scope 검사는 유지한다.
- 저장 응답은 기존 PRIVATE projection을 사용하며 방장 미가입 상태의
  `counterpart=null`, `allowedActions.reply=false`를 그대로 표시한다.
  서버 저장 완료를 방장 전달·읽음 완료로 표시하지 않는다.

## 영속성과 검증 범위

Android Room outbox의 기존 문자열 intent와 iOS GRDB JSON command에 새 의도를
보존한다. recipient를 생성하거나 복원 시 다른 의도로 바꾸지 않는다. DB schema 변경은
없으며, 기존 SHARED/PRIVATE row는 그대로 읽는다. 새 ROOM_OWNER row가 생긴 저장소를
이를 모르는 QA18 바이너리로 다운그레이드하는 경로는 지원하지 않는다. 후속 수정도 앞으로
진행하고 실패한 command를 삭제하거나 새 membership으로 재전송하지 않는다.

UNKNOWN 복원은 기존 receipt 조회만 수행한다. 통신 실패를 성공으로 바꾸거나 자동으로
새 clientMessageId를 만들어 재전송하지 않는다. 기존 역할/권한 변경에 따른 scope 폐기와
원래 명령의 보호 규칙을 재사용한다.

회귀 검사는 수신자 없는 기본 전송, PRIVATE 답장 보존, 미디어 명령 직렬화, actor/quote
주입 거부, 역할별 승인/거부, 실제 SQLite cold restore 후 원본 ID·본문·intent 보존,
UNKNOWN 재전송 금지를 포함한다. 격리 테스트의 합성 계정과 메시지는 제품에 들어가지 않는다.
서명 산출물 및 실제 QA 배포 확인은 최종 통합 SHA의 외부 release manifest에 별도 기록한다.
Firebase 서비스 계정 발급 차단은 별도 배포 경로 의존성이며 이 계약의 구현을 막지 않는다.


로컬 검증: Android 대화 계약·coordinator·화면 모델 5 suites/23 tests 통과.
iOS 전체 상태·실제 전송 경계 검사와 SwiftPM/GRDB 31 tests 및 대화 복구 검사가 통과했다.
Android 실제 SQLite cold-restore 계측과 양 OS 패키징의 최종 판정은 PR의 hosted CI로 확인한다.
