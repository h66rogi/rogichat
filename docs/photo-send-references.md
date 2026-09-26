# 사진 전송 화면 레퍼런스 (2026-09-26)

현재 카카오톡 Android/iPhone 화면 자료는 제공되지 않았다. 아래 공식 안내에서 확인한
선택 이후의 검토·받는 사람 확인·명시적 전송 단계를 사진 전송 UX의 기준으로 사용했다.

| 서비스와 공식 자료 | 확인한 동작 | Rogichat 반영 |
| --- | --- | --- |
| [WhatsApp Help Center: send media](https://faq.whatsapp.com/812276063311533/?cms_platform=android&helpref=platform_switcher) | 갤러리에서 사진을 고른 다음 전송 전 화면에서 사진과 설명을 확인한다. | 선택한 실제 사진을 미리 보고 설명을 입력한 뒤 보내기 버튼을 누른다. |
| [Signal Support: Broadcast Media](https://support.signal.org/hc/en-us/articles/360044640011-Broadcast-Media) | 미디어 선택, 설명 추가, 수신 대상 확인, 최종 보내기가 구분된다. | 방 이름과 받는 사람을 전송 전에 표시한다. |
| [KakaoTalk Tips: camera photo](https://talktips.kakao.com/easyread/content/40) | 촬영 후 결과를 확인하거나 다시 촬영한 뒤 전송한다. | 선택과 전송 사이에 검토·취소 단계를 둔다. 최신 앨범 화면의 레이아웃 근거로 사용하지 않는다. |

사진은 현재 한 번에 한 장씩 선택한다. 미리보기는 업로드된 표시용 이미지를 사용하며,
원본 화질 전송·사진 편집·여러 장 순서 지정 기능은 이 변경의 동작이 아니다.
서버 사진 파이프라인은 표시용 WebP를 생성하고 EXIF/XMP/IPTC/ICC 메타데이터를 제거한다.
스티커는 사진 선택 흐름과 별개로 유지한다.
