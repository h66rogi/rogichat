# 모바일 QA 업로드 후 확인

`qa_release.py android-finalize`와 `ios-finalize`는 기존 QA 빌드·업로드 도구의
manifest, 서명/패키지 검사와 인증을 재사용하는 **명시적 로컬 운영자 명령**이다.
앱을 빌드하거나 업로드하지 않으며, 상주 runner나 자동 배포 trigger를 설치하지 않는다.
공개 PR 작업에 인증 정보를 제공하거나 PR 산출물을 서명 환경에서 실행하지 않는다.

## 입력과 실행

승인된 운영자의 Mac에서 검토한 도구 커밋으로 실행한다. 기존 외부 QA 설정과 산출물을
사용한다. `release.json`은 설정된 `artifact_root/<platform>/<build>/release.json`에
있어야 하며 빌드 디렉터리는 700, 설정·테스터 목록·테스트 내용은 600 권한을 사용한다.
앱 식별자는 `chat.rogi.rogichat.qa`로 고정되어 있다. Production을 선택하는 옵션은 없다.

Android는 [기존 절차](mobile-test-distribution.md)로 APK 업로드를 끝낸 뒤 실행한다.
승인된 이메일만 별도 외부 파일에 쉼표 또는 줄바꿈으로 저장한다. 도구는 대소문자를
정규화하고 중복을 제거하며, 빈 목록·잘못된 주소·999명 초과를 거부한다.

```sh
python3 tools/mobile/qa_release.py --config "$ROGICHAT_QA_CONFIG" android-finalize \
  --manifest "$ROGICHAT_QA_ARTIFACTS/android/$ROGICHAT_QA_BUILD/release.json" \
  --testers-file "$ROGICHAT_QA_TESTERS_FILE"
```

Firebase CLI의 현재 로컬 로그인과 설치 경로를 사용한다. 고정된 사용자 홈이나 전역
Node 모듈 경로를 요구하지 않는다. CLI 인증 adapter가 지원되지 않거나 만료되면 실패하며,
기존 `firebase login --reauth --no-localhost` 절차로 운영자가 인증을 복구한다.
토큰은 캡처된 자식 프로세스 출력으로만 전달하고 로그·영수증에 저장하지 않는다.

iOS 외부 설정의 `ios.testflight_group_id`에 **기존에 승인된 내부 그룹의 정확한 ID**를
지정하고, 한국어 테스트 내용을 외부 파일에 저장한다. 그룹 ID·테스터 정보는 Git에 넣지 않는다.
도구는 QA 앱과 그룹의 연결 및 `isInternalGroup`을 재확인한다.

```sh
python3 tools/mobile/qa_release.py --config "$ROGICHAT_QA_CONFIG" ios-finalize \
  --manifest "$ROGICHAT_QA_ARTIFACTS/ios/$ROGICHAT_QA_BUILD/release.json" \
  --notes-file "$ROGICHAT_QA_NOTES_FILE" --wait-seconds 600
```

기본 대기는 0초이며 최대 600초 동안 15초 이하 간격으로 처리·읽기 확인만 반복한다.
같은 빌드의 `testflight-upload-attempt.json`이 `transport_completed`여야 한다.
`attempted`, 누락, 다른 빌드의 기록은 거부한다. 불확실한 업로드를 다시 전송하거나
기존 업로드 시도 기록을 삭제·초기화하지 않는다. 새 업로드 기록은 커밋·아카이브·IPA
해시도 포함하며, 기존 번호/상태 형식은 같은 canonical 빌드 디렉터리에서만 허용한다.
Xcode는 업로드 성공 후 아카이브 메타데이터를 수정할 수 있으므로, 업로드 도구는 전체
해시가 같은 독립 `UploadWorking.xcarchive` 복사본만 전달한다. 원본 아카이브와
manifest는 그대로 보존하고 Xcode가 수정한 작업 복사본은 비공개 증거로 남긴다.

## 검증과 완료 의미

| 대상 | 확인하는 사실 | 확인하지 못하는 사실 |
|---|---|---|
| Android | 로컬 QA 서명/APK·manifest 해시, Firebase 프로젝트/앱/package, 정확한 version/build의 유일한 원격 릴리스, 다운로드 APK SHA-256 일치, 지정 이메일에 대한 분배 응답, 프로젝트 테스터 등록 읽기 확인 | 이메일 수신·초대 수락·설치. Firebase 공개 API의 프로젝트 테스터 목록은 릴리스별 접근 목록이 아니다 |
| iOS | 로컬 Apple 검증된 아카이브/IPA·업로드 완료 기록, 정확한 QA 앱/버전/build/iOS, 만료 아님·`VALID`, 정확한 `ko` 테스트 내용, 승인된 내부 그룹의 빌드 연결과 테스터 존재, `IN_BETA_TESTING` | 테스터 설치·실행. App Store Connect는 원격 IPA 해시를 제공하지 않으므로 Android와 같은 원격 바이너리 해시 증명은 아니다 |

Apple/Firebase 목록을 마지막 페이지까지 읽고 반복 커서·외부 페이지 링크를 거부한다.
인증된 API의 redirect를 따르지 않는다. Firebase 서명 다운로드 URL에는 API bearer를
붙이지 않으며 HTTPS Google 저장소 경로와 로컬 APK 크기를 초과하지 않는 스트림을 검사한다.

## 중단과 재실행

각 빌드 디렉터리의 `finalization.lock`을 OS 배타 잠금으로 잡고 `finalization.json`에
manifest 해시, 대상, 입력 해시와 단계 상태를 600 권한으로 저장한다. 임시 파일 fsync,
원자적 교체, 디렉터리 fsync를 사용하며 프로세스 종료 후 잠금은 OS가 해제한다.
잠금 파일은 삭제하지 않는다. 다른 운영자가 같은 빌드를 처리 중이면 즉시 실패한다.

- 완료된 명령을 다시 실행해도 원격 상태를 재확인한다. 이전 영수증만 보고 성공하지 않는다.
- manifest, 대상 릴리스, 승인된 테스터 집합, 그룹, 테스트 내용이 바뀌면 기존 기록을
  덮어쓰지 않고 중단한다. 변경된 입력의 분배는 별도 승인·운영 작업으로 다룬다.
- Firebase 분배는 요청 직전 `attempted`, 성공 응답 직후 `accepted`를 기록한다.
  이후 등록 조회가 실패하면 재실행은 조회만 한다. 응답 유실·프로세스 종료로 `attempted`에
  머문 경우 분배를 자동 반복하지 않는다. 프로젝트 등록 조회만으로 분배 성공을 추정하지 않는다.
- Apple 테스트 내용/그룹 변경은 먼저 원격 값을 읽는다. 응답을 잃어도 재실행에서 정확한
  결과가 관측되면 기록을 확정한다. 관측되지 않은 시도를 반복하지 않으며, 수락한 변경의
  전파가 늦으면 대기 후 다시 읽는다. 이미 확인한 원격 값이 바뀌면 자동 덮어쓰지 않는다.
- 불확실한 상태는 개인 기록과 서비스 콘솔에서 운영자가 조사한다. 잠금·journal·업로드
  기록 삭제로 재시도를 강제하는 옵션은 제공하지 않는다. 미확인 상태를 배포 완료로 보고하지 않는다.

현재 범위는 기존 한 대의 신뢰된 로컬 운영 환경이다. 다중 호스트 조정, 빌드 번호 할당,
merged-QA 검증 trigger, 장기 실행 runner 및 별도 Production 승격은 후속 운영 구성이다.

공식 API 근거: [Firebase 분배의 초대/릴리스 이메일 동작](https://firebase.google.com/docs/reference/app-distribution/rest/v1/projects.apps.releases/distribute),
[Firebase 프로젝트 테스터 목록](https://firebase.google.com/docs/reference/app-distribution/rest/v1/projects.testers/list),
[Apple 내부 그룹 빌드 연결](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betagroups-_id_-relationships-builds).
