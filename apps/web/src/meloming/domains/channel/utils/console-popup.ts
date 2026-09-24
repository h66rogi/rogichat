/**
 * 콘솔 팝업 URL 생성 및 열기 유틸리티
 */

function buildConsoleUrl(
  user: string,
  token?: string | null,
): string {
  return token ? `/console/${user}?token=${token}` : `/console/${user}`;
}

export function openConsolePopup(
  user: string,
  token?: string | null,
): void {
  window.open(
    buildConsoleUrl(user, token),
    "live-console",
    "width=1280,height=900,scrollbars=yes,resizable=yes",
  );
}
