'use client';

import { useEffect, useState } from 'react';

// CSS container-type/cqw는 Chromium 105+에서만 지원. 구버전 OBS (CEF < 105)
// 에서 `min(Xpx, Ncqw)`를 inline fontSize에 그대로 넣으면 전체 declaration이
// invalid로 파싱되어 font-size/padding 등이 unset 되는 회귀가 생긴다.
// 이 모듈은 런타임 feature detection + fallback 생성 헬퍼를 제공한다.

let cachedSupport: boolean | null = null;

function detectContainerUnitsSupport(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  try {
    return (
      CSS.supports('container-type', 'inline-size') &&
      CSS.supports('font-size', '1cqw')
    );
  } catch {
    return false;
  }
}

/**
 * 서버/하이드레이션 첫 렌더에서는 false를 반환하여 px 전용 값을 내보내고,
 * 클라이언트 마운트 후 브라우저가 container queries를 지원하면 true로
 * 업데이트되어 다음 렌더부터 fluid 값이 적용된다. SSR↔CSR 간 inline style
 * mismatch를 피하기 위해 초기값은 항상 false.
 */
export function useContainerUnitsSupport(): boolean {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    if (cachedSupport === null) cachedSupport = detectContainerUnitsSupport();
    if (cachedSupport) setSupported(true);
  }, []);
  return supported;
}

/**
 * admin이 지정한 px 값을 상한으로 유지하면서, 지원 브라우저에서는 container
 * 폭의 N% 로 자동 축소되는 fluid font-size 문자열을 돌려준다. 비지원
 * 브라우저에서는 admin px 그대로.
 */
export function cqwCap(px: number, cqw: number, supportsCq: boolean): string {
  return supportsCq ? `min(${px}px, ${cqw}cqw)` : `${px}px`;
}

/**
 * padding / minWidth 같이 px 또는 fluid 문자열을 그대로 치환하고 싶은 경우의
 * 스위처. 지원 브라우저에서는 `fluidValue`, 아니면 `pxOnly` 반환.
 */
export function fluidOr<T extends string | number>(
  pxOnly: T,
  fluidValue: T,
  supportsCq: boolean,
): T {
  return supportsCq ? fluidValue : pxOnly;
}
