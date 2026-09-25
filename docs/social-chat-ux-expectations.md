# 사회·채팅 서비스 UI·UX 기대 동작 목록

조사·갱신일: **2026-09-25**. 이 문서는 새 채팅 서비스의 설계 질문과 사용성 검증 항목을 축적하는 자료다. 특정 제품의 기능표나 로기챗의 구현 약속이 아니다.

## 읽는 방법과 근거 수준

- Facebook Messenger, Telegram, WhatsApp, KakaoTalk, Discord, WeChat, LINE의 **운영사 공식 도움말·제품 안내**를 우선 확인했다. Android·Apple의 플랫폼 설계 문서, W3C 접근성 지침, 발표된 1차 사용자 연구도 보조 근거로 사용했다. 로그인한 앱을 전 기기·지역·요금제로 실측한 조사는 아니다.
- 아래의 **기본 계약**은 *해당 기능을 제공한다면* 사용자가 결과를 예측하고 확인할 수 있어야 한다는 뜻이다. **흔한 패턴**은 여러 제품 또는 플랫폼 지침에서 확인한 설계 후보이며, 채택 의무나 사용자 선호도의 통계적 순위를 뜻하지 않는다. **선택 확장**은 서비스 성격에 따라 결정한다.
- 출처의 관찰을 일반적인 기대 동작으로 바꾼 문장은 **설계 추론**이다. 특히 읽음·온라인·삭제·암호화·과거 기록·가입·알림의 의미와 기본값은 제품 정책과 사용자 조사로 정해야 한다. 타사 화면·문구·자산을 복제하지 않는다.
- 항목 ID를 유지하면서 새 근거, 반례, 사용자 조사 결과를 추가한다. 기능 정책을 확정하면 별도 제품 명세에 연결하고, 이 목록의 일반적 관찰을 곧바로 출시 범위로 승격하지 않는다.

### 확인한 1차 자료의 입구

| 서비스 | 공식 자료 |
| --- | --- |
| Facebook Messenger | [Meta Messenger 제품 공지](https://about.fb.com/news/2024/04/hd-photos-shared-albums-and-more-on-messenger/), [Meta 안전한 메시징 안내](https://about.fb.com/news/2021/12/metas-approach-to-safer-private-messaging/) |
| Telegram | [Telegram FAQ](https://www.telegram.org/faq), [제품 업데이트](https://telegram.org/blog/folders?setln=en) |
| WhatsApp | [읽음 확인 도움말](https://faq.whatsapp.com/665923838265756/), [그룹 알림 도움말](https://faq.whatsapp.com/797069521522888/) |
| KakaoTalk | [카카오톡 서비스 소개](https://www.kakaocorp.com/page/service/service/KakaoTalk), [오픈채팅 안내](https://www.kakaocorp.com/page/detail/10811) |
| Discord | [메시지 작성 도움말](https://support.discord.com/hc/en-us/articles/360034632292-Sending-Messages), [검색 도움말](https://support.discord.com/hc/en-us/articles/115000468588-How-to-Use-Search-on-Discord) |
| WeChat | [Tencent 제품 소개](https://www.tencent.com/products/weixin-wechat/), [WeChat 개발자가 제공한 앱 설명](https://apps.apple.com/us/app/wechat/id414478124) |
| LINE | [LINE 친구 추가 도움말](https://help.line.me/line/?contentId=200000585&lang=en), [LINE 채팅 도움말](https://help.line.me/line/smartphone?contentId=20005810&lang=en) |

읽음 표시가 사회적 압박과 사생활 우려에 연결된다는 [CHI 2017 직접 설문 연구](https://www.research.ed.ac.uk/en/publications/was-my-message-read-privacy-and-signaling-on-facebook-messenger/)와, 많은 그룹 알림을 줄이기 위해 음소거를 사용한다는 [그룹 채팅 참여 연구](https://academic.oup.com/jcmc/article/25/4/274/5866390)는 설계 질문을 만드는 근거다. 두 연구를 전체 사용자의 선호 비율로 일반화하지 않는다.

## 화면 문법: 반복해서 보이는 UI 패턴

근거: [Android 목록·상세 레이아웃](https://developer.android.com/design/ui/mobile/guides/layout-and-content/common-layouts), [Discord 모바일 구성](https://support.discord.com/hc/en-us/articles/12654190110999-New-Mobile-App-Updates-Layout), [Messenger 반응·멘션](https://about.fb.com/news/2017/03/introducing-message-reactions-and-mentions-for-messenger/), [Apple 디자인 원칙](https://developer.apple.com/design/human-interface-guidelines/design-principles). 아래는 관찰을 바탕으로 한 화면 설계 후보이며, 채널형·포럼형 대화에 말풍선 배치를 강제하지 않는다.

- **VIS-01 · 흔한 패턴** 휴대폰은 대화 목록→상세 화면, 큰 화면은 목록과 상세를 나란히 둔다.
- **VIS-02 · 기본 계약** 대화 헤더에 현재 상대/방과 핵심 상태를 보여주고 세부 정보·검색·통화로 이동한다.
- **VIS-03 · 흔한 패턴** 내 메시지와 타인 메시지는 위치·배경·발신자 표기를 조합해 구별한다.
- **VIS-04 · 기본 계약** 그룹의 연속 메시지를 압축해 보여줘도 작성자·시간·답장 관계는 추적할 수 있다.
- **VIS-05 · 흔한 패턴** 시각·전송 상태는 본문보다 약한 시각적 위계로 두되 필요할 때 정확한 값을 열어본다.
- **VIS-06 · 흔한 패턴** 읽지 않음 경계·새 메시지 수·최신으로 이동 버튼은 기록 탐색을 돕는 위치에 둔다.
- **VIS-07 · 기본 계약** 입력창은 키보드·안전 영역·화면 회전에 가려지지 않고 현재 대화에 붙어 있다.
- **VIS-08 · 기본 계약** 첨부·음성·보내기 버튼의 역할이 입력 상태에 따라 바뀐다면 아이콘과 접근성 이름도 맞게 바뀐다.
- **VIS-09 · 흔한 패턴** 인용 답장 대상은 입력창 위에 작게 보여주고 보내기 전 해제할 수 있다.
- **VIS-10 · 흔한 패턴** 휴대폰 길게 누르기와 데스크톱 우클릭/호버가 같은 메시지 행동으로 이어진다.
- **VIS-11 · 흔한 패턴** 반응은 해당 메시지에 붙은 작은 표식으로 보여주고 눌러 세부 반응을 확인한다.
- **VIS-12 · 흔한 패턴** 사진·영상은 인라인 썸네일, 파일은 이름·형식, 음성은 재생 컨트롤로 식별한다.
- **VIS-13 · 기본 계약** 전체 화면 미디어를 닫으면 원래 읽던 대화 위치로 돌아온다.
- **VIS-14 · 기본 계약** 빈 상태·불러오는 중·전송 실패·접근 불가가 서로 다른 화면과 행동을 제공한다.
- **VIS-15 · 기본 계약** 중요한 행동을 호버, 스와이프, 색 변화에만 숨기지 않고 보이는 대안을 둔다.
- **VIS-16 · 흔한 패턴** 밝은/어두운 테마와 사용자 배경을 지원하더라도 메시지 대비·상태 표시가 유지된다.

## 1. 계정, 관계, 대화 시작

근거: [Android 메시징 단계 안내](https://developer.android.com/social-and-messaging/guides/communication/basic-better-best), [Telegram FAQ](https://www.telegram.org/faq), [Discord 친구 추가](https://support.discord.com/hc/en-us/articles/218344397-How-do-I-add-friends-on-Discord), [Discord 메시지 요청](https://support.discord.com/hc/en-us/articles/7924992471191-Message-Requests), [LINE 친구 추가](https://help.line.me/line/?contentId=200000585&lang=en), [Messenger QR 연결](https://about.fb.com/news/2024/04/hd-photos-shared-albums-and-more-on-messenger/).

- **ID-01 · 기본 계약** 계정 생성·로그인·복원 뒤 현재 누구로 대화하는지 분명히 알 수 있다.
- **ID-02 · 기본 계약** 한 기기에서 계정을 바꾸면 이전 계정의 대화, 초안, 알림, 검색 결과가 새 계정에 섞이지 않는다.
- **ID-03 · 흔한 패턴** 이름·아이디·전화번호·연락처·QR·초대 링크·공통 공간 등 허용된 경로에서 사람을 찾는다.
- **ID-04 · 기본 계약** 검색 결과에서 상대의 이름·사진·구별 가능한 정보를 보고 잘못된 사람에게 보내지 않게 한다.
- **ID-05 · 기본 계약** 연락처 접근은 요청 이유와 범위를 설명하고, 거절해도 가능한 다른 대화 시작 경로를 보여준다.
- **ID-06 · 기본 계약** 전화번호·아이디·검색·공통 공간별 발견 가능 범위와 변경할 수 있는 설정을 명확히 보여준다.
- **ID-07 · 흔한 패턴** 친구 요청·팔로우·대화 초대의 대기·수락·거절·취소 상태를 구분한다.
- **ID-08 · 흔한 패턴** 낯선 사람의 첫 메시지는 요청함·스팸함 등 검토 가능한 위치에 두고 수락·삭제·신고를 제공한다.
- **ID-09 · 기본 계약** 메시지 요청을 수락할 때 상대에게 무엇이 보이고 어떤 후속 연락이 허용되는지 예측할 수 있다.
- **ID-10 · 기본 계약** 이미 대화 중인 상대와 새 대화를 시작하면 기존 기록을 찾거나 새 공간이 생기는 이유를 이해한다.
- **ID-11 · 기본 계약** 대화 시작이 허용되지 않으면 실패를 표시하고 가능한 행동을 안내하되 상대의 비공개 설정을 노출하지 않는다.
- **ID-12 · 선택 확장** 공개 주제방에서는 실계정 프로필과 방별 프로필을 분리하고 어느 이름으로 발언하는지 보여준다.
- **ID-13 · 선택 확장** 중요한 방은 입력창 잠금으로 오발송을 줄일 수 있다. [카카오톡 입력창 잠금](https://www.kakaocorp.com/page/detail/9953). 발송 전 수신자 재확인은 별도 설계 후보이다.

## 2. 정보 구조와 대화 목록

근거: [Android 목록·상세 레이아웃](https://developer.android.com/design/ui/mobile/guides/layout-and-content/common-layouts), [Telegram 폴더·보관](https://telegram.org/blog/folders?setln=en), [Discord 모바일 구성](https://support.discord.com/hc/en-us/articles/12654190110999-New-Mobile-App-Updates-Layout), [WhatsApp 검색](https://faq.whatsapp.com/1131773267485499/), [카카오톡 제품 소개](https://www.kakaocorp.com/page/service/service/KakaoTalk).

- **LIST-01 · 흔한 패턴** 대화 목록에서 상대/방 이름, 아바타, 최근 메시지, 시각, 읽지 않음 상태를 한눈에 훑는다.
- **LIST-02 · 기본 계약** 1:1, 그룹, 공개 공간, 공지형 채널의 성격을 진입 전 구분한다.
- **LIST-03 · 기본 계약** 빈 목록은 실제로 대화가 없음을 말하고 시작할 수 있는 행동을 제시한다.
- **LIST-04 · 기본 계약** 목록을 열 때 로딩·오류·권한 상실을 빈 목록으로 오해하지 않는다.
- **LIST-05 · 흔한 패턴** 최근 활동을 기본 정렬로 하되 중요한 대화는 고정·즐겨찾기 할 수 있다.
- **LIST-06 · 기본 계약** 고정, 보관, 숨김, 삭제, 읽지 않음 표시는 서로 다른 결과를 낸다.
- **LIST-07 · 기본 계약** 보관한 대화에 새 메시지가 오면 목록으로 돌아오는지, 보관함에 남는지 규칙이 일관된다.
- **LIST-08 · 흔한 패턴** 개인 메모용 ‘읽지 않음’ 표시는 상대에게 보이는 실제 읽음 상태와 분리한다.
- **LIST-09 · 흔한 패턴** 읽지 않은 대화, 멘션, 요청, 그룹 등을 필터하거나 묶어 볼 수 있다.
- **LIST-10 · 흔한 패턴** 대화가 많으면 폴더·카테고리·접기·즐겨찾기로 탐색 부담을 줄인다.
- **LIST-11 · 기본 계약** 목록의 미리보기는 잠금·차단·비공개·삭제 정책과 일치한다.
- **LIST-12 · 기본 계약** 알림을 눌러 들어가거나 뒤로 가도 읽던 대화와 목록 위치를 가능한 한 보존한다.
- **LIST-13 · 기본 계약** 모바일 좁은 화면과 큰 화면에서 목록↔대화 이동이 예측 가능하다.
- **LIST-14 · 선택 확장** 초안이 있는 대화와 입력 중인 다른 사람을 목록에서 구별해 보여준다.
- **LIST-15 · 선택 확장** 조용한 대화는 알림뿐 아니라 배지·상단 노출을 어떻게 처리하는지 정한다. [카카오톡 조용한 채팅방](https://www.kakaocorp.com/page/detail/10583).

## 3. 대화 타임라인 읽기

근거: [Telegram FAQ](https://www.telegram.org/faq), [Telegram 날짜·안 읽은 메시지 이동](https://telegram.org/blog/telegram-5-ios?setln=en), [Discord 받은 편지함](https://support.discord.com/hc/en-us/articles/360045027712-Inbox-FAQ), [LINE 채팅 도움말](https://help.line.me/line/smartphone?contentId=20005810&lang=en), [W3C 채팅 로그 접근성 예시](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA23).

- **READ-01 · 기본 계약** 각 메시지에서 작성자, 내용, 시간, 내 메시지 여부를 혼동하지 않는다.
- **READ-02 · 기본 계약** 날짜 경계와 시간대가 일관되고, 오래된 메시지의 순서가 뒤바뀌지 않는다.
- **READ-03 · 기본 계약** 새 메시지가 와도 과거 내용을 읽는 사용자의 위치를 강제로 최신으로 옮기지 않는다.
- **READ-04 · 흔한 패턴** 최신 메시지로 이동하는 버튼과 첫 읽지 않은 메시지의 경계를 제공한다.
- **READ-05 · 기본 계약** 이전 기록을 불러올 때 현재 읽던 메시지와 스크롤 위치를 보존한다.
- **READ-06 · 기본 계약** 답장·검색·고정 항목에서 원문 위치로 이동하며 원문이 없으면 이유를 알 수 있다.
- **READ-07 · 기본 계약** 삭제·만료·접근 권한 변경으로 볼 수 없는 메시지를 임의 본문으로 채우지 않는다.
- **READ-08 · 기본 계약** 같은 메시지가 재연결·다른 기기 동기화 뒤 중복으로 나타나지 않는다.
- **READ-09 · 기본 계약** 그룹에서는 같은 발신자의 연속 메시지를 묶더라도 발신자와 시간 맥락을 잃지 않는다.
- **READ-10 · 흔한 패턴** 링크·주소·전화번호 등은 원문을 읽고 필요한 후속 행동으로 이어질 수 있다.
- **READ-11 · 기본 계약** 반응, 편집, 삭제, 답장이 원문 맥락을 지우거나 엉뚱한 메시지에 붙지 않는다.
- **READ-12 · 기본 계약** 개인/전체 등 공개 범위가 다른 메시지를 제공한다면 그 범위를 시각·접근성 정보로 분명히 구분한다.
- **READ-13 · 선택 확장** 일정·투표·공지·통화 기록 같은 사건을 일반 메시지와 구별해 시간순으로 보여준다.
- **READ-14 · 기본 계약** 메시지를 눌러 미디어나 프로필을 열고 돌아오면 읽던 맥락이 유지된다.

## 4. 작성, 수신자 확인, 전송

근거: [Android 메시징 단계 안내](https://developer.android.com/social-and-messaging/guides/communication/basic-better-best), [Telegram 초안 동기화](https://telegram.org/blog/drafts?setln=en), [Discord 메시지 작성](https://support.discord.com/hc/en-us/articles/360034632292-Sending-Messages), [Discord 답글](https://support.discord.com/hc/en-us/articles/360057382374-Replies-FAQ), [Messenger 답장·미디어 작성](https://about.fb.com/news/2022/01/updates-to-end-to-end-encrypted-chats-messenger/).

- **SEND-01 · 기본 계약** 입력 중인 대화방과 실제 수신자가 항상 보인다. 답장 대상이나 전체/개인 전송 모드가 있다면 함께 구분한다.
- **SEND-02 · 기본 계약** 대화나 계정을 전환한 뒤 이전 방의 초안이 다른 대상에게 보내지지 않는다.
- **SEND-03 · 흔한 패턴** 대화별 초안을 보존하고 돌아왔을 때 작성 위치를 복원한다.
- **SEND-04 · 기본 계약** 빈 메시지, 길이 제한, 금지된 첨부 등은 전송 전에 이해 가능한 방식으로 알려준다.
- **SEND-05 · 기본 계약** 보내기와 줄바꿈 키의 동작을 플랫폼에 맞게 일관되게 제공한다.
- **SEND-06 · 기본 계약** 전송을 누른 직후 입력이 사라져도 메시지와 전송 상태를 타임라인에서 추적할 수 있다.
- **SEND-07 · 기본 계약** 전송 중, 서버 접수, 상대에게 전달, 읽음은 실제 확인 가능한 단계만 표시한다.
- **SEND-08 · 기본 계약** 서버 접수를 상대의 전달 또는 읽음으로 표시하지 않는다. 체크 표시·숫자·문구의 의미를 제품 안에서 설명한다.
- **SEND-09 · 기본 계약** 실패한 메시지는 본문·첨부·대상을 보존하고 재시도 또는 취소할 수 있다.
- **SEND-10 · 기본 계약** 재시도나 응답 유실 뒤 동일 메시지가 중복 전송되지 않게 한다.
- **SEND-11 · 기본 계약** 차단, 권한 부족, 읽기 전용, 느린 모드, 용량 초과, 네트워크 문제를 가능한 범위에서 구별한다.
- **SEND-12 · 기본 계약** 상대의 설정 또는 차단 여부를 알 수 없을 때 ‘읽지 않았다’ 같은 단정을 피한다.
- **SEND-13 · 흔한 패턴** 특정 메시지를 인용해 답장하고, 보낼 때 원문과 알림 대상이 무엇인지 알 수 있다.
- **SEND-14 · 선택 확장** 예약 전송, 무음 전송, 멘션, 서식 입력은 제공 범위와 제한을 작성 단계에서 보여준다.
- **SEND-15 · 기본 계약** 보내기 직전 수신자·공개 범위·첨부를 바꾸면 이전 선택이 남아 오발송하지 않는다.

## 5. 읽음, 온라인, 입력 중 상태

근거: [WhatsApp 읽음 확인](https://faq.whatsapp.com/665923838265756/), [Telegram 체크와 접속 상태](https://www.telegram.org/faq), [Discord 접속 상태](https://support.discord.com/hc/en-us/articles/227779547-Changing-Online-Status), [Messenger 읽음 제어](https://about.fb.com/news/2023/12/default-end-to-end-encryption-on-messenger/), [Messenger 입력 중 표시](https://about.fb.com/news/2022/01/updates-to-end-to-end-encrypted-chats-messenger/), [LINE 읽음 주의](https://help.line.me/line/?contentId=20021705), [읽음 표시와 사회적 압박에 관한 CHI 사용자 조사](https://www.research.ed.ac.uk/en/publications/was-my-message-read-privacy-and-signaling-on-facebook-messenger/).

- **PRES-01 · 기본 계약** ‘읽음’의 발생 조건을 정한다. 대화 열기, 화면 노출, 알림 미리보기는 같은 사건이 아닐 수 있다.
- **PRES-02 · 기본 계약** 읽음 표시를 제공할 경우 1:1과 그룹에서 누구의 어떤 읽음을 나타내는지 분명히 한다.
- **PRES-03 · 기본 계약** 읽음 숨기기 설정과 발신자가 볼 수 있는 상태의 관계를 설명한다.
- **PRES-04 · 기본 계약** 읽음 표시를 답장 약속이나 상대의 관심·감정의 증거처럼 표현하지 않는다.
- **PRES-05 · 흔한 패턴** 입력 중 상태는 실시간 대화의 신호지만, 상대가 보내지 않고 멈출 수도 있음을 전제로 표시한다.
- **PRES-06 · 기본 계약** 온라인·최근 접속·자리 비움은 서로 다른 의미를 갖고 공개 범위를 제어한다.
- **PRES-07 · 기본 계약** 마지막 접속이 보이지 않는 이유를 차단이나 특정 개인의 행동으로 추정하지 않는다.
- **PRES-08 · 선택 확장** 음성 메시지의 ‘전달·읽음·재생’을 구별한다.
- **PRES-09 · 선택 확장** 그룹 읽음 정보를 제공한다면 전체 합계와 멤버별 확인 가능 범위를 구분한다.

## 6. 보낸 뒤 메시지 행동

근거: [WhatsApp 반응](https://faq.whatsapp.com/424198503229937/), [WhatsApp 전달](https://faq.whatsapp.com/887468535575482/), [WhatsApp 수정](https://about.fb.com/news/2023/05/edit-whatsapp-messages/), [WhatsApp 삭제](https://faq.whatsapp.com/1370476507114859/), [Discord 수정](https://support.discord.com/hc/en-us/articles/207618817-How-do-I-edit-my-messages), [Discord 반응](https://support.discord.com/hc/en-us/articles/12102061808663-Reactions-and-Super-Reactions-FAQ), [Discord 전달](https://support.discord.com/hc/en-us/articles/24640649961367-Message-Forwarding), [Telegram FAQ](https://www.telegram.org/faq).

- **ACT-01 · 흔한 패턴** 길게 누르기, 우클릭, 키보드 등으로 답장·복사·공유·반응·고정·신고 메뉴에 접근한다.
- **ACT-02 · 기본 계약** 행동 메뉴는 내 메시지, 타인 메시지, 운영자 권한별로 가능한 항목만 보여준다.
- **ACT-03 · 기본 계약** 편집 중 원문과 변경 내용을 확인하고 저장·취소할 수 있다.
- **ACT-04 · 기본 계약** 수정된 메시지는 수정 사실 또는 제품이 정한 이력 정책을 일관되게 드러낸다.
- **ACT-05 · 기본 계약** ‘나에게만 삭제’와 ‘모두에게 삭제’의 범위를 구분한다.
- **ACT-06 · 기본 계약** 삭제 불가 시점·대상·실패를 사전에 설명하고 실제 성공을 확인한다.
- **ACT-07 · 기본 계약** 상대가 이미 읽거나 저장한 내용까지 원격 삭제로 회수된다고 약속하지 않는다.
- **ACT-08 · 흔한 패턴** 반응은 추가·변경·취소할 수 있고, 반응 수와 내 반응을 구별한다.
- **ACT-09 · 기본 계약** 여러 사람이 반응했을 때 누가 보이는지는 방의 공개·익명 정책과 일치한다.
- **ACT-10 · 흔한 패턴** 전달된 메시지는 현재 발신자가 직접 작성한 것처럼 보이지 않게 한다. 원작성자·출처·원본 접근 가능 여부는 실제 확인 범위만 표시한다.
- **ACT-11 · 기본 계약** 복사·전달·다운로드가 제한된 콘텐츠는 이유와 허용 행동을 알려준다.
- **ACT-12 · 흔한 패턴** 고정·별표·저장 메시지는 모아서 찾고 원래 대화로 돌아갈 수 있다.
- **ACT-13 · 기본 계약** 고정 해제, 반응 철회, 삭제는 다른 기기의 화면과도 같은 결과로 수렴한다.
- **ACT-14 · 기본 계약** 특정 메시지를 신고할 때 신고 대상과 포함되는 주변 맥락을 알 수 있다. [LINE 신고 도움말](https://help.line.me/line/android/pc?contentId=20000298&lang=en).

## 7. 사진, 파일, 음성, 링크

근거: [Android 풍부한 콘텐츠·첨부 상태](https://developer.android.com/social-and-messaging/guides/communication/basic-better-best), [Messenger 고화질 사진·앨범·파일](https://about.fb.com/news/2024/04/hd-photos-shared-albums-and-more-on-messenger/), [WhatsApp 음성 메시지](https://about.fb.com/news/2022/03/new-voice-message-features-on-whatsapp/), [Telegram 첨부·다운로드](https://telegram.org/blog/downloads-attachments-streaming?setln=en), [Discord 파일 첨부](https://support.discord.com/hc/en-us/articles/25444343291031-File-Attachments-FAQ), [LINE 메시지 도움말](https://help.line.me/line/smartphone?contentId=20007005&lang=en), [WeChat 앱 설명](https://apps.apple.com/us/app/wechat/id414478124).

- **MEDIA-01 · 기본 계약** 첨부 전 파일 종류·개수·크기 제한과 권한 요청 이유를 알 수 있다.
- **MEDIA-02 · 흔한 패턴** 사진·동영상·파일·음성·스티커·GIF·연락처·위치 등을 필요에 맞게 보낸다.
- **MEDIA-03 · 기본 계약** 선택한 사진·파일과 전송 대상을 마지막에 미리 확인하고 잘못 선택한 항목을 뺀다.
- **MEDIA-04 · 흔한 패턴** 여러 미디어의 순서·캡션·화질 또는 원본 품질을 조절한다.
- **MEDIA-05 · 기본 계약** 업로드·처리·다운로드의 진행, 대기, 실패, 재시도 상태를 보여준다.
- **MEDIA-06 · 기본 계약** 사진·영상에는 썸네일과 전체 보기, 파일에는 이름·형식·크기를 제공한다.
- **MEDIA-07 · 기본 계약** 미디어를 열 수 없으면 만료·권한·형식·연결 문제를 가능한 범위에서 구별한다.
- **MEDIA-08 · 기본 계약** 다른 대화의 비공개 첨부가 링크 미리보기·공유 화면·캐시에 새지 않는다.
- **MEDIA-09 · 흔한 패턴** 채팅방별 공유 사진·파일·링크를 모아본다.
- **MEDIA-10 · 흔한 패턴** 음성 녹음은 시작·일시정지·취소·전송 전 듣기를 제공한다.
- **MEDIA-11 · 기본 계약** 음성 재생 중 다른 화면·기기·이어폰·잠금 상태 변화의 결과가 예측 가능하다.
- **MEDIA-12 · 선택 확장** 음성 배속·이어듣기·자막/전사, 사진 편집·공유 앨범을 제공할 수 있다.
- **MEDIA-13 · 기본 계약** 링크 미리보기의 제목·이미지·주소가 실제 목적지와 혼동을 만들지 않는다.
- **MEDIA-14 · 기본 계약** 위치 공유는 단발 위치와 실시간 위치를 구별하고 실시간 공유는 종료 시점을 보여준다.
- **MEDIA-15 · 선택 확장** 수상한 링크는 겉보기 문구와 실제 도메인을 확인하고 열기 전 경고한다. [WhatsApp 링크 도움말](https://faq.whatsapp.com/393169153028916/).
- **MEDIA-16 · 기본 계약** 수신 미디어의 자동 다운로드와 기기 갤러리 저장은 구별하고 네트워크·저장 공간·채팅별 설정 결과를 예측할 수 있다. [WhatsApp 자동 다운로드](https://faq.whatsapp.com/366146522333492/), [갤러리 저장](https://faq.whatsapp.com/476272750957554/).

## 8. 검색과 기록 정리

근거: [Discord 검색](https://support.discord.com/hc/en-us/articles/115000468588-How-to-Use-Search-on-Discord), [Telegram 검색 필터](https://telegram.org/blog/filters-anonymous-admins-comments?setln=en), [Telegram 공유 미디어 탐색](https://telegram.org/blog/shared-media-scrolling-calendar-join-requests-and-more?setln=en), [WhatsApp 검색](https://faq.whatsapp.com/1131773267485499/), [LINE 채팅 도움말](https://help.line.me/line/smartphone?contentId=20005810&lang=en).

- **SEARCH-01 · 기본 계약** 사람·대화·공간 검색과 메시지 본문 검색의 범위를 구분한다.
- **SEARCH-02 · 기본 계약** 현재 방 검색인지 모든 접근 가능 대화 검색인지 입력 전에 알 수 있다.
- **SEARCH-03 · 흔한 패턴** 작성자·날짜·방·사진·파일·링크 등으로 좁힌다.
- **SEARCH-04 · 기본 계약** 검색 결과에서 일치 부분과 발신자·방·날짜 맥락을 확인한다.
- **SEARCH-05 · 기본 계약** 결과를 누르면 원본 메시지 위치로 이동하고 주변 대화를 읽을 수 있다.
- **SEARCH-06 · 기본 계약** 삭제·만료·탈퇴·권한 상실 콘텐츠는 검색 결과에서도 같은 범위로 제거한다.
- **SEARCH-07 · 기본 계약** 검색 중·결과 없음·검색 불가를 구분하며, 색인 중이면 그 상태를 설명한다.
- **SEARCH-08 · 흔한 패턴** 날짜 이동·빠른 스크롤·저장/고정 항목으로 긴 기록을 탐색한다.
- **SEARCH-09 · 선택 확장** 포럼·주제형 공간에서는 태그·제목·작성자별 검색을 제공한다.

## 9. 그룹, 커뮤니티, 방송형 공간

근거: [WhatsApp 그룹 가입·관리](https://faq.whatsapp.com/3242937609289432/), [Telegram 그룹 FAQ](https://www.telegram.org/faq), [Telegram 가입 요청](https://telegram.org/blog/shared-media-scrolling-calendar-join-requests-and-more?setln=en), [Discord 역할·권한](https://support.discord.com/hc/en-us/articles/214836687-Discord-Roles-and-Permissions), [Discord 온보딩](https://support.discord.com/hc/en-us/articles/11074987197975-Community-Onboarding-FAQ), [LINE 그룹 초대·가입](https://help.line.me/line/desktop/?contentId=20008159), [LINE 그룹 이탈·제거](https://help.line.me/line?contentId=20000420), [카카오 오픈채팅](https://www.kakaocorp.com/page/detail/10811).

- **GROUP-01 · 기본 계약** 그룹의 이름·사진·설명·규칙·멤버·역할을 찾을 수 있다.
- **GROUP-02 · 기본 계약** 초대, 가입 요청, 승인, 거절, 취소, 강퇴, 자발적 탈퇴를 구별한다.
- **GROUP-03 · 기본 계약** 링크·QR 초대는 누가 들어올 수 있는지와 공유 위험을 알려준다.
- **GROUP-04 · 흔한 패턴** 관리자는 초대 링크를 만료·재발급·비활성화하고 가입을 승인한다.
- **GROUP-05 · 기본 계약** 새 멤버에게 과거 기록이 보이는 범위를 입장 전 또는 설정에서 설명한다.
- **GROUP-06 · 기본 계약** 그룹을 떠날 때 남는 기록·알림·재입장 가능성과 다른 멤버에게 보이는 사건을 알 수 있다.
- **GROUP-07 · 기본 계약** 관리자·일반 멤버·읽기 전용 멤버의 발언·첨부·초대·정보 변경 권한을 분리한다.
- **GROUP-08 · 기본 계약** 발언할 수 없는 공간에서 입력창을 가짜로 활성화하지 않는다.
- **GROUP-09 · 기본 계약** 멤버가 많아질수록 멘션·답글의 알림 범위와 대화 맥락을 관리한다.
- **GROUP-10 · 흔한 패턴** 카테고리·채널·스레드·토픽으로 한 공간의 주제를 나눈다.
- **GROUP-11 · 기본 계약** 채널별 읽기·쓰기·보기 권한이 목록, 검색, 알림, 공유 링크에도 같이 적용된다.
- **GROUP-12 · 흔한 패턴** 새 참가자에게 시작 안내와 관심 채널·역할 선택을 제공한다.
- **GROUP-13 · 선택 확장** 방송형 채널은 발행자와 구독자의 역할, 댓글/토론 위치를 일반 그룹과 구별한다.
- **GROUP-14 · 선택 확장** 공개 주제방은 별도 프로필·입장 코드·승인과 검색 노출 정책을 둔다.
- **GROUP-15 · 선택 확장** 공지·투표·일정·노트·앨범은 대화와 연결하되 각각의 수정·삭제·권한을 정한다.
- **GROUP-16 · 기본 계약** 운영자 이탈·소유권 이전 뒤 누가 공간을 관리할 수 있는지 결정한다.
- **GROUP-17 · 기본 계약** 나가기와 강퇴가 다른 멤버에게 어떤 흔적을 남기는지 설명한다. [카카오톡 조용히 나가기](https://www.kakaocorp.com/page/detail/9951), [LINE 그룹 도움말](https://help.line.me/line?contentId=20000420).
- **GROUP-18 · 기본 계약** 누가 나를 그룹에 바로 추가할 수 있는지와 초대 수락이 필요한 경우를 입장 전에 알 수 있다. [WhatsApp 그룹 초대 설정](https://faq.whatsapp.com/1131457590844955/).

## 10. 알림과 주의 집중

근거: [Apple 알림 설계](https://developer.apple.com/design/human-interface-guidelines/notifications/), [Android 알림 설계](https://developer.android.com/design/ui/mobile/guides/home-screen/notifications), [Discord 알림 설정](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101), [WhatsApp 그룹 알림](https://faq.whatsapp.com/797069521522888/), [LINE 알림 도움말](https://help.line.me/line?contentId=20011380), [그룹 채팅 참여 연구](https://academic.oup.com/jcmc/article/25/4/274/5866390).

- **NOTI-01 · 기본 계약** 알림 허용을 요청할 때 어떤 대화 알림을 받는지 설명한다.
- **NOTI-02 · 기본 계약** 앱 안 설정, 대화별 설정, 운영체제 권한·집중 모드의 관계를 알 수 있다.
- **NOTI-03 · 흔한 패턴** 앱 전체·대화·그룹·채널·스레드별로 음소거 또는 예외를 설정한다.
- **NOTI-04 · 흔한 패턴** 모든 메시지·직접 멘션/답장만·없음 같은 수준을 고른다.
- **NOTI-05 · 흔한 패턴** 일정 기간 음소거와 직접 켤 때까지 음소거를 구분한다.
- **NOTI-06 · 기본 계약** 알림을 꺼도 메시지가 수신·저장되는지와 읽지 않음 표시에 미치는 영향을 설명한다.
- **NOTI-07 · 기본 계약** 알림을 누르면 해당 대화와 메시지로 이동하며, 접근 불가라면 다른 사람의 내용을 보여주지 않는다.
- **NOTI-08 · 기본 계약** 현재 열어 읽고 있는 대화에서 중복 소리·배너를 피한다.
- **NOTI-09 · 기본 계약** 같은 사건이 여러 기기나 재연결에서 중복 알림으로 폭증하지 않는다.
- **NOTI-10 · 기본 계약** 잠금 화면·미리보기·발신자 이름의 노출 범위가 개인정보 설정과 일치한다.
- **NOTI-11 · 기본 계약** 배지는 실제 미확인 사건을 나타내고 읽거나 처리하면 갱신된다.
- **NOTI-12 · 기본 계약** 배지·소리·색만으로 중요한 정보를 전달하지 않는다.
- **NOTI-13 · 기본 계약** 알림이 안 올 때 OS 권한과 앱 설정을 확인할 수 있는 길이 있다.
- **NOTI-14 · 선택 확장** 멘션, 답장, 통화, 반응, 친구 요청, 커뮤니티 공지를 서로 다른 알림 정책으로 둔다.
- **NOTI-15 · 선택 확장** 알림에서 빠른 답장을 제공한다면 실제 발송 상태와 오류를 앱 안에서도 확인한다. [Android 메시징 알림](https://developer.android.com/social-and-messaging/guides/communication/notifications-conversations).
- **NOTI-16 · 기본 계약** 음소거된 대화에서 멘션·답장 알림을 예외로 보낼지 명시한다. [LINE 알림 도움말](https://help.line.me/line?contentId=20011380).

## 11. 음성·영상 통화와 실시간 공간

근거: [WhatsApp 통화](https://faq.whatsapp.com/1153602608602452/), [WhatsApp 그룹 통화](https://faq.whatsapp.com/829612741557179/), [Messenger 통화 업데이트](https://about.fb.com/news/2024/11/introducing-ai-backgrounds-noise-suppression-and-more-messenger-calling/), [Discord 그룹 채팅과 통화](https://support.discord.com/hc/en-us/articles/223657667-Group-Chat-and-Calls), [Android 메시징 단계 안내](https://developer.android.com/social-and-messaging/guides/communication/basic-better-best).

- **CALL-01 · 기본 계약** 통화 버튼은 상대·그룹·음성/영상 종류를 분명히 보여준다.
- **CALL-02 · 기본 계약** 걸기·울림·연결·끊김·거절·부재중을 다른 상태로 표시한다.
- **CALL-03 · 기본 계약** 카메라·마이크 권한을 실제 필요 시 요청하고 거절·철회 상태를 처리한다.
- **CALL-04 · 기본 계약** 통화 중 음소거, 카메라 끄기, 오디오 출력 전환 상태가 상대와 내 화면에 일관된다.
- **CALL-05 · 기본 계약** 화면 잠금·앱 전환·네트워크 변경 중 이어짐/종료의 결과를 이해한다.
- **CALL-06 · 흔한 패턴** 그룹 통화는 참가자 목록, 누가 말하는지, 합류·재합류 경로를 제공한다.
- **CALL-07 · 기본 계약** 통화 중 새 참가자 또는 화면 공유의 공개 범위를 표시한다.
- **CALL-08 · 기본 계약** 연결 불량 시 품질 저하·재연결·종료를 숨기지 않는다.
- **CALL-09 · 흔한 패턴** 부재중 기록에서 바로 답장하거나 다시 걸 수 있다.
- **CALL-10 · 선택 확장** 음성 채널처럼 상시 열려 있는 공간은 전화처럼 초대받는 통화와 구별한다.
- **CALL-11 · 선택 확장** 화면 공유·소음 제거·데이터 절약은 상대에게 보이는 범위와 기기 지원 조건을 정한다.
- **CALL-12 · 기본 계약** 통화 중 새 전화와 모르는 발신자의 전화를 어떻게 처리할지 정하고 거절·무음 처리한 통화도 기록에서 확인한다. [WhatsApp 통화 대기](https://faq.whatsapp.com/692484435227181/).

## 12. 프로필과 채팅 주변의 사회적 활동

근거: [카카오톡 제품 소개](https://www.kakaocorp.com/page/service/service/KakaoTalk), [LINE OpenChat 안내 — 제공 지역 확인 필요](https://openchat.line.me/jp/guide), [Weixin·WeChat 제품 소개](https://www.tencent.com/products/weixin-wechat/), [WeChat 앱 설명](https://apps.apple.com/us/app/wechat/id414478124), [Android 소셜·메시징 개요](https://developer.android.com/social-and-messaging/guides).

- **SOC-01 · 기본 계약** 프로필 사진·표시 이름·상태가 대화의 발신자와 일관되게 연결된다.
- **SOC-02 · 기본 계약** 프로필의 공개 범위와 실제 대화 상대에게 보이는 정보가 일치한다.
- **SOC-03 · 흔한 패턴** 상대 프로필에서 대화·통화·공통 공간·차단/신고로 이어진다.
- **SOC-04 · 기본 계약** 표시 이름이 바뀌어도 과거 대화의 작성자 관계가 유지된다.
- **SOC-05 · 흔한 패턴** 게시물·스토리·상태 업데이트를 보고 반응하거나 대화로 공유할 수 있다.
- **SOC-06 · 기본 계약** 게시물 공개 범위는 친구·그룹·공개 공간·특정 대상 등 제품 정책과 맞게 예측된다.
- **SOC-07 · 기본 계약** 게시물, 프로필, 대화, 그룹의 차단/숨김 범위를 혼동하지 않는다.
- **SOC-08 · 선택 확장** 공식 계정·브랜드·봇·미니앱은 사람과 구별되는 신원·응답 기대·권한을 표시한다.
- **SOC-09 · 선택 확장** 결제·선물·예약·라이브 방송은 채팅의 기반 기대가 아니라 지역·서비스별 별도 흐름으로 다룬다.
- **SOC-10 · 선택 확장** 공식·인증 계정의 표식을 제공한다면 일반 사용자와 혼동되지 않게 발행 주체를 확인한다. [LINE 공식 계정](https://help.line.me/line?contentId=20000143).

## 13. 프라이버시, 안전, 신뢰

근거: [WhatsApp 프라이버시 설정](https://faq.whatsapp.com/3307102709559968/), [WhatsApp 차단](https://faq.whatsapp.com/414631957536067/), [Messenger 종단 간 암호화 안내](https://about.fb.com/news/2024/03/end-to-end-encryption-on-messenger-explained/), [Discord 안전한 메시지](https://support.discord.com/hc/en-us/articles/115000068672-Safer-Messaging-on-Discord), [Discord 신고](https://support.discord.com/hc/en-us/articles/22582288274071-Reporting-Abusive-Behavior-to-Discord), [Telegram 스팸 FAQ](https://telegram.org/faq_spam?setln=en), [카카오톡 안전 기능](https://www.kakaocorp.com/page/detail/10583).

- **SAFE-01 · 기본 계약** 차단, 신고, 음소거, 보관, 숨김, 대화 삭제의 효과를 각각 구분한다.
- **SAFE-02 · 기본 계약** 원치 않는 상대를 대화와 프로필에서 쉽게 차단·신고한다.
- **SAFE-03 · 기본 계약** 신고 대상(메시지·사용자·방)과 신고 후 기대할 수 있는 결과를 설명한다.
- **SAFE-04 · 기본 계약** 차단이 이전 기록과 공통 그룹에 미치는 범위를 분명히 한다.
- **SAFE-05 · 기본 계약** 스팸·사기·악성 링크의 위험을 줄이되 정상 대화를 막은 경우 복구 경로를 둔다.
- **SAFE-06 · 기본 계약** 제한·정지·느린 모드에서 읽기와 쓰기의 가능 여부를 분명히 한다.
- **SAFE-07 · 기본 계약** 잠금 화면, 공유 메뉴, 검색, 사진 저장소에서 비공개 대화가 노출되는 범위를 제어한다.
- **SAFE-08 · 기본 계약** 프로필 사진, 전화번호, 최근 접속, 온라인, 읽음의 공개 범위를 독립적으로 검토한다.
- **SAFE-09 · 기본 계약** 메시지·첨부의 보존, 자동 삭제, 내보내기, 백업 범위를 실제 처리와 일치시킨다.
- **SAFE-10 · 기본 계약** 암호화 또는 ‘비밀 대화’를 제공한다면 적용 대상, 백업·신고·새 기기 복원 예외를 정확히 설명한다.
- **SAFE-11 · 기본 계약** 1회 보기·사라지는 메시지도 스크린샷·전달·외부 저장을 절대 막는다고 주장하지 않는다.
- **SAFE-12 · 기본 계약** 실시간 위치 공유는 참여자·시간·정지 행동을 언제나 확인할 수 있다.
- **SAFE-13 · 흔한 패턴** 의심스러운 발신자나 민감한 미디어는 자동 노출 전에 검토할 수 있다.
- **SAFE-14 · 선택 확장** 관리자용 금지어·자동 관리·느린 모드·일시 정지는 권한과 이의제기 경로를 갖춘다.
- **SAFE-15 · 흔한 패턴** 메시지 요청함의 미디어·링크는 열기 전에 검토할 수 있게 한다. 자동 다운로드 동작은 사용자 설정과 일치시킨다. [Meta 안전한 메시징](https://about.fb.com/news/2021/12/metas-approach-to-safer-private-messaging/), [WhatsApp 미디어 다운로드 설정](https://faq.whatsapp.com/366146522333492/).

## 14. 여러 기기, 오프라인, 복구

근거: [Android 오프라인·오류 처리](https://developer.android.com/social-and-messaging/guides/communication/basic-better-best), [WhatsApp 연결 기기](https://faq.whatsapp.com/1046791737425017/), [WhatsApp 백업·복원](https://faq.whatsapp.com/481135090640375/), [WhatsApp 기기 간 전송](https://faq.whatsapp.com/209942271778103/), [Messenger 새 기기 복원](https://about.fb.com/news/2024/03/end-to-end-encryption-on-messenger-explained/), [Telegram 초안 동기화](https://telegram.org/blog/drafts?setln=en).

- **SYNC-01 · 기본 계약** 연결이 끊겨도 현재 작성 중인 텍스트와 이미 보이는 기록이 갑자기 사라지지 않는다.
- **SYNC-02 · 기본 계약** 오프라인에서 가능한 읽기·작성·전송 대기를 구분한다.
- **SYNC-03 · 기본 계약** 전송 대기 메시지는 재연결 후의 처리 결과를 확인할 수 있다.
- **SYNC-04 · 기본 계약** 전송 결과를 모를 때 중복 발송 없이 조회·복구하는 경로를 둔다.
- **SYNC-05 · 기본 계약** 다른 기기에서 보낸·편집한·삭제한 메시지가 현재 기기와 일관되게 수렴한다.
- **SYNC-06 · 기본 계약** 읽음, 미확인 수, 고정, 반응, 초안의 동기화 범위를 항목별로 정한다.
- **SYNC-07 · 기본 계약** 오래된 기록을 불러오는 동안 새 메시지가 와도 위치·순서·중복이 깨지지 않는다.
- **SYNC-08 · 기본 계약** 앱 재시작·백그라운드 복귀·네트워크 전환 뒤 대화가 최신 상태로 회복된다.
- **SYNC-09 · 기본 계약** 새 기기 로그인과 기존 기기 해제·기기 목록·원격 로그아웃의 결과를 확인한다.
- **SYNC-10 · 기본 계약** 기기 교체 시 서버 동기화, 로컬 이전, 백업 복원의 포함 범위를 구분한다.
- **SYNC-11 · 기본 계약** 복원 중 진행·실패·누락 범위와 마지막 백업 시점을 확인한다.
- **SYNC-12 · 기본 계약** 암호화 키·복구 코드 분실 시 복원 불가 범위를 솔직하게 알린다.
- **SYNC-13 · 기본 계약** 계정 로그아웃·탈퇴·권한 상실 뒤 이전 계정의 로컬 기록과 알림을 안전하게 정리한다.
- **SYNC-14 · 선택 확장** 기기 간 통화 이어받기, 연속 초안, 검색 색인 복원은 지원 범위를 명시한다.
- **SYNC-15 · 기본 계약** 복원 완료와 검색·미디어 색인 완료가 다른 단계라면 남은 작업을 알 수 있다.

## 15. 접근성, 국제화, 기기 적응

근거: [W3C WCAG 2.2](https://www.w3.org/TR/wcag/), [W3C 채팅 로그 예시](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA23), [W3C 상태 메시지](https://www.w3.org/WAI/WCAG21/Understanding/status-messages), [Apple 포용적 설계](https://developer.apple.com/design/human-interface-guidelines/inclusion), [Android 메시징 접근성 권고](https://developer.android.com/social-and-messaging/guides/communication/basic-better-best).

- **A11Y-01 · 기본 계약** 텍스트 확대·화면 확대·작은 화면에서도 메시지, 입력창, 메뉴가 잘리거나 겹치지 않는다.
- **A11Y-02 · 기본 계약** 읽지 않음, 전송 실패, 비공개 범위, 음소거를 색이나 아이콘 모양만으로 구분하지 않는다.
- **A11Y-03 · 기본 계약** 버튼·반응·메시지 메뉴에 이해 가능한 접근성 이름과 상태를 제공한다.
- **A11Y-04 · 기본 계약** 새 메시지와 전송 실패를 스크린 리더에 알리되 현재 읽는 내용을 과도하게 끊지 않는다.
- **A11Y-05 · 기본 계약** 새 메시지가 추가돼도 키보드·스크린 리더 포커스를 임의로 빼앗지 않는다.
- **A11Y-06 · 기본 계약** 메시지 순서, 작성자, 시간, 인용, 반응을 읽기 순서에서도 이해할 수 있다.
- **A11Y-07 · 기본 계약** 스와이프·길게 누르기만으로 가능한 행동에 버튼·메뉴·키보드 대안을 둔다.
- **A11Y-08 · 기본 계약** 터치 대상과 간격을 충분히 확보하고 위험한 삭제/전달 오탭을 줄인다.
- **A11Y-09 · 기본 계약** 음성·영상의 자막·전사·대체 텍스트 필요성을 검토한다.
- **A11Y-10 · 기본 계약** 키보드, 화면 회전, 접이식·태블릿·데스크톱 크기 변화에도 입력 중 맥락을 보존한다.
- **A11Y-11 · 기본 계약** 한글 조합 중 전송, 긴 이름·문장, 이모지 결합 문자, 오른쪽에서 왼쪽으로 쓰는 언어를 시험한다.
- **A11Y-12 · 기본 계약** 시간·날짜·숫자·호칭을 언어와 지역 설정에 맞추고 원래 사건 순서를 잃지 않는다.
- **A11Y-13 · 기본 계약** 로그인·인증 코드는 자동완성·붙여넣기·보조기술을 막지 않는다.
- **A11Y-14 · 기본 계약** 움직임·효과음·진동은 OS의 접근성·무음 설정을 존중한다.
- **A11Y-15 · 선택 확장** 대화 배경·글자 크기·애니메이션을 조절할 수 있게 한다면 가독성과 대비를 유지한다. [LINE 채팅 표시 설정](https://help.line.me/line/smartphone?contentId=20005811&lang=en).

## 16. 설정과 계정 생애주기

근거: [Telegram 계정·기기 FAQ](https://www.telegram.org/faq), [LINE 계정 이전](https://help.line.me/?contentId=20000098), [LINE 계정 삭제](https://help.line.me/line?contentId=20000121), [Discord 데이터 사본 요청](https://support.discord.com/hc/en-us/articles/360004027692-Requesting-a-Copy-of-your-Data), [W3C 접근 가능한 인증](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum).

- **ACCOUNT-01 · 기본 계약** 프로필, 개인정보, 알림, 차단, 연결 기기, 도움말을 예측 가능한 설정 위치에서 찾는다.
- **ACCOUNT-02 · 기본 계약** 프로필 편집은 현재 값·입력 중인 값·저장 성공·실패·취소를 구분한다.
- **ACCOUNT-03 · 기본 계약** 연락처·사진·마이크·카메라·알림 권한의 현재 상태와 OS 설정으로 가는 길을 확인한다.
- **ACCOUNT-04 · 기본 계약** 차단 목록을 확인하고 차단 해제의 범위를 이해한다.
- **ACCOUNT-05 · 기본 계약** 로그인된 기기와 세션을 확인하고 더 이상 사용하지 않는 기기를 해제한다.
- **ACCOUNT-06 · 흔한 패턴** 새 기기 로그인·계정 복구 같은 민감한 사건을 실제 계정 소유자가 확인할 수 있다.
- **ACCOUNT-07 · 기본 계약** 로그인 수단·전화번호·이메일을 바꿀 때 기존 대화와 관계의 유지 범위를 설명한다.
- **ACCOUNT-08 · 기본 계약** 계정 복구가 가능한 조건과 불가능한 조건을 미리 알 수 있다.
- **ACCOUNT-09 · 기본 계약** 로그아웃, 앱 삭제, 대화 삭제, 계정 탈퇴가 각각 무엇을 지우는지 구분한다.
- **ACCOUNT-10 · 기본 계약** 탈퇴 전에 복원 불가 데이터, 상대에게 남는 대화 사본, 그룹 운영 권한의 결과를 확인한다.
- **ACCOUNT-11 · 기본 계약** 탈퇴 완료 또는 실패를 명확히 알리고, 완료된 계정에는 오래된 기기에서도 접근하지 못하게 한다.
- **ACCOUNT-12 · 기본 계약** 데이터 사본 요청을 제공한다면 포함 범위·준비 상태·받는 경로를 안내한다.
- **ACCOUNT-13 · 기본 계약** 데이터 내보내기·백업 요청과 계정 삭제가 동시에 진행될 때 어떤 작업이 취소되는지 알린다.
- **ACCOUNT-14 · 기본 계약** 로그인·복구 뒤 기존 기기의 세션이 유지되는지 해제되는지 확인한다.
- **ACCOUNT-15 · 기본 계약** 개인 설정이 여러 기기에 적용되는지, 기기별 설정인지 구분한다.
- **ACCOUNT-16 · 기본 계약** 제한·복구 실패·기기 분실 상황에서 접근 가능한 도움말과 지원 경로를 제공한다.

## 제품 정책으로 반드시 따로 정할 질문

1. 읽음·전달·온라인·입력 중 상태를 제공할지, 어떤 사건과 공개 설정에 연결할지?
2. 전화번호·친구 관계·공개 검색·초대 링크 중 어느 경로를 허용하며 기본 공개 범위는 무엇인지?
3. 새 멤버가 과거 그룹 기록을 볼지, 그룹 이탈·강퇴를 누구에게 알릴지?
4. 편집·나에게만 삭제·모두에게 삭제·자동 삭제의 범위와 기한은 무엇인지?
5. 전송 실패·응답 유실·오프라인에서 자동 재시도와 사용자 확인의 경계는 어디인지?
6. 잠금 화면, 검색, 알림, 기기 교체, 백업에서 비공개 내용을 어디까지 노출·복원할지?
7. 대화·미디어·통화·피드·커뮤니티 중 이 제품의 핵심 흐름과 선택 확장은 무엇인지?

## 업데이트 절차와 조사 공백

- 새 항목은 **ID·기대 동작·공식 근거·조건/반례**를 함께 추가한다. 기존 항목이 틀렸다면 변경 기록에 근거와 수정 이유를 적는다.
- 정기 재검토에서는 공식 문서의 갱신일·지역·플랫폼·유료 기능 여부를 확인한다. 특히 LINE 무음 전송처럼 지역·요금제별 제공이 달라질 수 있는 기능은 일반 기대치로 승격하지 않는다. [LINE 안내](https://help.line.me/line?contentId=20023607).
- LINE OpenChat은 지역별 제공 범위가 있는 사례다. 일본어 가이드의 방별 프로필·입장 흐름을 모든 지역의 LINE 기본 기능으로 해석하지 않는다. [LINE 제공 지역 고지](https://help.line.me/line?contentId=20014753).
- Weixin과 WeChat은 연동되지만 서로 다른 서비스다. 중국 본토 Weixin의 결제·미니프로그램을 전 세계 WeChat 기본 동작으로 일반화하지 않는다. [Tencent 제품 소개](https://www.tencent.com/products/weixin-wechat/), [WeChat 앱 설명](https://apps.apple.com/us/app/wechat/id414478124).
- WeChat 공개 고객센터의 세부 도움말은 이번 조사 환경에서 확인하지 못했다. 읽음·삭제 기한 등 확인되지 않은 세부 규칙은 이 목록의 근거로 사용하지 않았다.
- 공식 도움말 중심 조사라 실제 사용 흐름의 속도·발견 가능성·선호도는 검증하지 못했다. 다음 단계는 표적 사용자 인터뷰, Android/iOS/Web 실기기 과업 관찰, 접근성 시험, 정책별 프로토타입 비교다.

### 변경 기록

| 날짜 | 변경 |
| --- | --- |
| 2026-09-25 | 7개 서비스와 플랫폼·접근성·사용자 연구를 바탕으로 첫 범주형 목록 작성. |
