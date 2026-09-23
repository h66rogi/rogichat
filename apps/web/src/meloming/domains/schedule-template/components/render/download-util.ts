/**
 * 원격 이미지 URL 을 fetch 해 `a[download]` 클릭으로 로컬 저장.
 *
 * 단순 `<a download>` 로는 cross-origin 이미지에서 브라우저가
 * `download` 속성을 무시하고 새 탭을 여는 동작이 있다. blob 변환을 거치면
 * same-origin 으로 취급되어 파일명이 보존된다.
 *
 * 실패 시 네이티브 Error 를 throw 하므로 호출 측에서 toast 로 알림.
 */
export async function downloadImageAsPng(
  imageUrl: string,
  filename: string,
): Promise<void> {
  if (!imageUrl) {
    throw new Error("이미지 URL 이 비어 있습니다.");
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("브라우저 환경에서만 다운로드할 수 있습니다.");
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`이미지를 불러오지 못했어요 (HTTP ${response.status}).`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  } finally {
    // 즉시 revoke 하면 일부 브라우저(safari) 에서 다운로드가 취소되는 사례가
    // 보고되어 다음 tick 에 revoke. 메모리는 blob 크기만큼 일시 점유.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

/**
 * 파일명 생성: `schedule-<identifier>-<weekKey>.png`.
 *
 * 식별자에 특수문자(/, ?, 공백, 한글 NFD 등) 가 들어가면 OS 에 따라 저장 실패
 * 가능하므로 안전한 문자만 남긴다. 영문/숫자/한글/하이픈/언더스코어 허용.
 */
export function buildScheduleImageFilename(
  identifier: string,
  weekStartDateKey: string,
): string {
  const safeIdentifier = sanitizeFilenameSegment(identifier) || "channel";
  const safeWeek = sanitizeFilenameSegment(weekStartDateKey) || "week";
  return `schedule-${safeIdentifier}-${safeWeek}.png`;
}

function sanitizeFilenameSegment(segment: string): string {
  // 경로 구분자 및 제어문자 제거. 허용: 영문/숫자/한글/기본 구분자.
  return segment
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "")
    .trim();
}
