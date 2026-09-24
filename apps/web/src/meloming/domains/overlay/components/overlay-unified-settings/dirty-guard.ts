/**
 * 오버레이 테마 설정 페이지의 "저장하지 않은 변경사항"을 페이지 외부(사이드바)에
 * 노출하기 위한 모듈 수준 플래그.
 *
 * - `ThemeConfigSection`이 isDirty 변경 시 `set()`으로 갱신
 * - 사이드바 `<Link>`의 onClick에서 `confirmIfDirty()`로 확인 → false면 navigation 막음
 */
let isDirty = false;

export const overlayThemeDirtyGuard = {
  set(next: boolean) {
    isDirty = next;
  },
  confirmIfDirty(): boolean {
    if (!isDirty) return true;
    if (typeof window === "undefined") return true;
    return window.confirm("저장하지 않은 변경사항이 있습니다. 이동할까요?");
  },
};
