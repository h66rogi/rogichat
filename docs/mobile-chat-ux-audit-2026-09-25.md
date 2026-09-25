# 모바일 채팅 UX 감사 — 2026-09-25

## 수정 진행 기록 — 2026-09-26

이 문서의 아래 표는 수정 전 QA 소스의 감사 기록이다. 이번 변경에서는 다음을 적용했다.

- iOS·Android: 같은 계정·참여 권한으로 대화에 다시 들어올 때 기존 메시지, 프로필, 읽던 위치와 작성 중인 글을 유지하고 변경분을 조회한다. 권한이 실제로 종료되면 해당 화면 데이터를 폐기한다.
- iOS·Android: 전송과 작업 결과의 내부 확인 단계를 화면에서 숨기고, 조회 가능한 결과는 앱이 자동으로 확인한다. 작성·전송은 독립적인 기록 조회 때문에 멈추지 않는다.
- iOS·Android: 기본 프로필 이미지와 권한 범위가 묶인 이미지 캐시, 메시지 반응 수와 선택·취소 흐름, 작성창의 첨부 미리보기와 사진·동영상 설명을 추가했다. Android는 연속 메시지의 반복 정보를 줄이고 입력 한도를 전송 규칙과 맞췄다.
- API·웹: 사진·동영상 설명을 단일 메시지의 선택적 필드로 지원한다. 웹도 새 메시지를 읽고 표시하며, 첨부와 설명을 함께 보낼 수 있다.
- 방 목록, 차단, 알림, 탈퇴 화면에서 기술적인 상태·복구 문구를 줄이고 가능한 상태 조회를 자동으로 진행한다.

검증 범위: API 단위 테스트, 웹 단위 테스트·타입 검사, Android QA 단위 테스트, iOS 저장소 패키지 테스트와 iOS QA·운영 구성의 서명 없는 빌드를 실행했다. 최종 커밋의 CI·QA 배포 및 실기기 조작 검증은 별도 확인한다. 동영상은 말풍선에서 포스터를 즉시 보여 주지만 재생 시에는 아직 권한을 검사한 전체 파일 다운로드가 끝나야 첫 프레임을 재생한다. 이 부분은 권한 변경 시 즉시 중단되고 URL이 디스크에 남지 않는 스트리밍 경로가 필요하다.

## 범위와 판정 기준

- 대상: QA 소스의 Rogichat iOS·Android 네이티브 앱. 코드와 사용자 표시 문구를 읽기 전용으로 추적했다. 실제 기기 재현·발생 빈도는 별도 검증이 필요하다.
- 기준: 채팅은 현재 메시지와 사용자가 할 일 중심으로 표시한다. 저장·전송·복구의 내부 단계와 그 확인 절차를 사용자에게 맡기지 않는다. 대화를 다시 열어도 초안·읽던 위치·이미 로드한 내용을 가능한 한 유지한다.
- 이 문서는 발견 사항과 권장 방향을 기록한다. 제품 코드 변경이나 수정 완료를 뜻하지 않는다.

## 확인한 문제

| 우선순위 | 범위 | 확인한 동작과 사용자 영향 | 코드 근거 | 권장 방향 |
| --- | --- | --- | --- | --- |
| P1 | iOS·Android 채팅 | 전송 대기 항목에 “저장 여부”, “서버에 저장됨”, “전송 결과 확인 필요” 등 내부 단계를 표시하고 수동 확인 버튼을 제공한다. | `apps/ios/Sources/Features/Conversation/ConversationScreen.swift:431-440`, `apps/ios/Packages/RogichatRooms/Sources/RogichatRooms/TextCommand.swift:56-64`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationScreen.kt:104-120` | 메시지 자체와 최소한의 전달 상태만 보여주고, 결과 조회·복구는 자동 처리한다. 실제로 사용자의 선택이 필요한 실패만 명확히 표시한다. |
| P1 | Android 채팅 재진입 | 대화 `open`과 `refresh`가 기존 `ConversationState`를 빈 로딩 상태로 교체한다. 화면 경로의 ViewModel이 해제되면 작성 중인 글도 지운다. 다시 열 때 전체 로딩과 초안 손실 가능성이 있다. | `apps/android/app/src/main/java/chat/rogi/rogichat/core/conversation/RoomConversationCoordinator.kt:64-71,129-140`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationViewModel.kt:145`, `apps/android/app/src/main/java/chat/rogi/rogichat/AppEntry.kt:240-249` | 현재 권한 범위에서 읽은 내용을 유지하며 갱신하고, 방별 초안을 탐색 수명과 분리해 보존한다. |
| P2 | iOS·Android 프로필 사진 | 텍스트 아바타 또는 빈 위치에서 로딩 스피너로 바뀌고, 뷰 재구성 시 이미지를 다시 비우는 경로가 있다. 프로필 사진이 깜빡이거나 실패 버튼으로 대체될 수 있다. | `apps/ios/Sources/Features/Conversation/ConversationScreen.swift:335-349`, `apps/ios/Sources/Features/Media/AuthorizedMedia.swift:26-43,89-100`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/media/AuthorizedMedia.kt:34-42,68-81,92-117` | 크기가 고정된 기본 이미지·스켈레톤을 유지하고 성공한 이미지는 접근 범위에 맞게 재사용한다. |
| P2 | iOS·Android 메시지 작업 | 반응이 메시지 메뉴 안의 이모지 버튼과 “현재 상태 확인”으로 제공된다. 알 수 없는 결과에서는 재전송 여부 같은 내부 복구 설명을 표시한다. 신고 사유 선택은 이미 모달로 구현돼 있다. | `apps/ios/Sources/Features/MessageActions/MessageActionsPanel.swift:15-64,68-93`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/messageactions/MessageActionsPanel.kt:21-66,69-87` | 반응 선택과 취소를 메시지 가까이 두고, 메뉴에서 내부 상태 점검 항목을 제거한다. 신고 모달은 유지하되 완료·실패 피드백을 간결히 다듬는다. |
| P2 | iOS·Android 대화방 목록 | 참여·나가기 결과가 불명확할 때 “앞선 요청의 처리 결과”와 수동 상태 확인을 노출한다. | `apps/ios/Sources/Core/Rooms/RoomsScreenModel.swift:108-115`, `apps/ios/Sources/Features/Rooms/RoomsScreen.swift:14-20`, `apps/android/app/src/main/java/chat/rogi/rogichat/core/rooms/RoomCommands.kt:10-20`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/rooms/RoomsScreen.kt:170-180` | 현재 참여 여부를 자동으로 다시 읽어 화면에 반영하고, 필요한 경우에만 사용자가 이해할 수 있는 행동을 제시한다. |
| P1 | iOS·Android 반응 | 채팅 말풍선에는 반응 수와 내 반응이 표시되지 않는다. 메시지 메뉴를 처음 열 때도 iOS는 `reactions = nil`, Android는 현재 반응을 조회하지 않으므로, “내 반응 취소”는 수동 상태 확인 전에는 보이지 않는다. | `apps/ios/Sources/Features/Conversation/ConversationScreen.swift:291-330`, `apps/ios/Sources/Features/Conversation/ConversationFeatures.swift:194-222`, `apps/ios/Sources/Features/MessageActions/MessageActionsPanel.swift:18-36`, `apps/android/app/src/main/java/chat/rogi/rogichat/core/conversation/RoomConversationCoordinator.kt:277-287`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationScreen.kt:175-211` | 말풍선에 현재 반응을 표시하고, 반응 선택기를 열기 전에 최신 상태를 가져와 한 번의 동작으로 추가·변경·취소한다. |
| P1 | iOS 채팅 갱신 | 앱 복귀 시 전체 `refresh()`를 실행하며 현재 로드한 메시지 각각을 순차적으로 다시 조회한다. 갱신과 이전 기록 로딩 중에는 보내기까지 비활성화된다. 메시지가 많거나 연결이 느릴수록 불필요하게 긴 대기와 입력 제한이 생길 수 있다. | `apps/ios/Sources/Features/Conversation/ConversationScreen.swift:119-127`, `apps/ios/Packages/RogichatRooms/Sources/RogichatRooms/RoomConversationCoordinator.swift:40-81`, `apps/ios/Sources/Features/Conversation/ConversationScreenModel.swift:29-49` | 보유한 대화를 유지한 채 변경분 위주로 동기화하고, 독립적인 기록 조회가 작성·전송을 막지 않게 한다. |
| P2 | iOS 첫 진입·재시작 | 로컬에 대화 기록이 있어도 초기 모델은 `.idle`이고 `load()`는 원격 `refresh()`가 끝나야 목록을 표시한다. 네트워크 오류가 난 뒤에야 `failed()`가 로컬 목록을 읽는다. | `apps/ios/Sources/Features/Conversation/ConversationScreenModel.swift:12-38,111-128`, `apps/ios/Sources/Features/Conversation/ConversationScreen.swift:93-111` | 현재 인가가 유효한 범위에서 로컬 목록을 우선 표시하고 뒤에서 갱신한다. |
| P1 | Android 메시지 작업·초안 | 삭제·작성자 차단 결과를 처리할 때 `data = null`로 대화 전체를 비우고 재조회한다. 이때 ViewModel은 `data == null && !loading`을 만나 작성 중인 글도 지울 수 있다. | `apps/android/app/src/main/java/chat/rogi/rogichat/core/conversation/RoomConversationCoordinator.kt:314-340`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationViewModel.kt:37-51`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationScreen.kt:48-52` | 바뀐 메시지 또는 접근 범위만 교체하고, 현재 대화와 초안은 유지한다. |
| P2 | Android 읽던 위치 | 복원 시 위치 계산에 쓰는 대기 항목 수가 실제 목록에 렌더링하는 필터와 다르다. 삭제·보류된 항목 또는 다른 참여 범위의 항목이 있으면 복원 인덱스가 어긋날 수 있다. | `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationScreen.kt:66-73,102-123` | 렌더링된 항목의 안정적인 키로 위치를 복원하고, 과거 페이지 로딩·대기 항목 변화도 함께 검증한다. |
| P2 | iOS·Android 미디어 보기 | 이미지·동영상은 셀마다 별도 임시 파일로 다시 내려받으며 표시 컴포넌트 종료 시 화면 이미지도 지운다. 동영상은 최대 약 50MB 전체 다운로드가 끝난 뒤 재생을 시작한다. 스크롤·재진입 때 재로딩과 긴 동영상 대기가 예상된다. | `apps/ios/Sources/Features/Media/AuthorizedMedia.swift:38-70`, `apps/ios/Sources/Core/Media/MediaDownload.swift:13-44`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/media/AuthorizedMedia.kt:40-81`, `apps/android/app/src/main/java/chat/rogi/rogichat/core/media/MediaDownload.kt:15-52` | 접근 권한 수명과 계정 경계를 지키는 이미지 재사용·썸네일, 빠른 동영상 미리보기/재생 경로를 설계한다. |
| P2 | Android 작성창 | 입력창은 20,000자까지 받아들이지만 전송 규칙은 4,000자까지만 허용한다. 전송 버튼은 글자가 비어 있지 않으면 활성화되어, 긴 글을 작성한 뒤에야 오류를 보여준다. | `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationViewModel.kt:56-57,122-127`, `apps/android/app/src/main/java/chat/rogi/rogichat/core/conversation/ConversationContract.kt:93-97`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationScreen.kt:160-164` | 입력 가능 길이, 남은 길이 안내, 보내기 활성 조건을 실제 전송 규칙과 일치시킨다. |
| P2 | iOS·Android 작성·첨부 | iOS 첨부는 별도 시트에서 “메시지로 보내기”를 눌러 전송하고, Android는 글이 있으면 첨부 선택을 막는다. 작성한 글과 사진을 하나의 자연스러운 작성 흐름으로 결합할 수 없다. | `apps/ios/Sources/Features/Conversation/ConversationScreen.swift:183-192,388-418`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationScreen.kt:142-164`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationViewModel.kt:95-120` | 작성창에 첨부 미리보기를 통합한다. 텍스트와 첨부의 동시 전송은 서버 계약과 함께 확인한다. |
| P3 | Android 말풍선 | 모든 메시지마다 작성자, 전체 날짜·시각, “메시지 메뉴” 버튼이 반복된다. 대화가 길수록 본문보다 반복 메타데이터가 화면을 많이 차지한다. | `apps/android/app/src/main/java/chat/rogi/rogichat/feature/conversation/ConversationScreen.kt:175-211` | 연속된 같은 작성자 메시지를 묶고, 시간·작업은 필요할 때 쉽게 찾을 수 있는 방식으로 표시한다. |

## 채팅 밖의 동일 계열 문구

- 차단 관리: 이전 차단 요청의 결과 미확인과 “현재 상태 확인”이 화면에 직접 나온다. `apps/ios/Sources/Features/MessageActions/ActorBlocksPanel.swift:24-30`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/messageactions/ActorBlocksPanel.kt:20-26`.
- 탈퇴·계정 복구: “요청을 다시 보내지 않고”, “기기 정보 정리”, “서버에 접수되었을 수 있어요”, “접수 기록”처럼 내부 처리 설명이 설정 또는 전역 상태 화면에 나타난다. 다만 실제 탈퇴 결과와 복구 가능성은 사용자에게 중요하므로, 사실관계와 안전장치를 유지한 채 쉬운 문구와 명확한 행동으로 재설계해야 한다. `apps/ios/Sources/ProductRootView.swift:60-66,192-194`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/settings/AccountDeletionStatus.kt:17-42`.
- 알림 설정: “푸시 연결”, “현재 서버에서 기기 알림 등록을 지원하지 않아요” 등 구현 상태를 사용자가 읽는다. `apps/ios/Sources/Core/Push/NativePushApplication.swift:68-72`, `apps/android/app/src/main/java/chat/rogi/rogichat/feature/settings/DevicePushSection.kt:21-53`.

## 확인된 양호한 부분과 검증 한계

- iOS는 같은 방·인가 범위의 coordinator와 화면 모델을 재사용하는 경로가 있다. 위치 복원 로직도 존재한다. 따라서 Android와 동일한 재진입 초기화로 단정하지 않는다.
- iOS·Android 신고 사유 선택은 각각 시스템 대화상자와 `AlertDialog`로 제공된다.
- 웹의 “다른 탭” 또는 “전송 저장소 다시 연결” 문구는 네이티브 소스에서 발견되지 않았다. 다중 기기·장시간 백그라운드 후의 실제 동작은 이 코드 조사만으로 검증되지 않았다.
- 이번 환경에는 연결된 Android 기기와 사용 가능한 iOS `simctl`이 없어 실제 화면 캡처·접근성·네트워크 지연 재현을 하지 못했다. 코드에서 확정되는 표시/상태 전이와 체감 성능에 관한 예상을 구분해 기록했다.

## 후속 기기 검증 시나리오

1. 양 OS에서 작성 중 다른 방으로 갔다가 돌아오기, 앱을 백그라운드로 보냈다가 복귀하기, 앱 프로세스를 종료하고 재실행하기. 초안·읽던 위치·이전 메시지·사진이 각각 어떻게 유지되는지 기록한다.
2. 느린 연결에서 보낸 직후·응답 유실·저장 성공 후 메시지 조회 실패를 재현한다. 사용자 화면에 내부 저장/확인 상태가 나타나는지, 중복 전송 없이 자동 수렴하는지 확인한다.
3. 이미 반응이 있는 메시지와 내가 반응한 메시지를 처음 연다. 말풍선의 반응 수, 선택기의 현재 선택, 한 번에 변경/취소 가능한지 확인한다.
4. Android에서 초안이 있는 상태로 다른 메시지를 삭제하거나 작성자를 차단한다. 대화 전체 점멸과 초안 손실 여부를 확인한다.
5. 미디어가 많은 대화를 위아래로 스크롤하고 긴 동영상을 재생한다. 재다운로드 횟수, 첫 화면·첫 프레임 시간, 기본 이미지 표시와 셀 크기 변화를 확인한다.
6. Android에서 4,000자를 넘겨 입력하고 뒤늦게 전송 실패가 발생하는지 확인한다. 글자 확대, TalkBack·VoiceOver, 키보드 표시 상태에서도 작성창과 메시지 작업 접근성을 확인한다.
