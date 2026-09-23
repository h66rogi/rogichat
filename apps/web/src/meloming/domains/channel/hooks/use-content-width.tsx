"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface ContentWidthContextType {
  isContentWide: boolean;
  setIsContentWide: (wide: boolean) => void;
}

const ContentWidthContext = createContext<ContentWidthContextType>({
  isContentWide: false,
  setIsContentWide: () => {},
});

/**
 * 콘텐츠 너비 상태를 관리하는 Provider
 * - 채널 레이아웃에서 서버 기본값(defaultWide)으로 초기화
 * - 노래책 등 개별 탭에서 setIsContentWide로 동적 변경 가능
 * - ChannelSideBanners가 이 상태를 읽어 배너 배치 방식 결정
 */
export function ContentWidthProvider({
  defaultWide,
  children,
}: {
  defaultWide: boolean;
  children: ReactNode;
}) {
  const [isContentWide, setIsContentWide] = useState(defaultWide);

  return (
    <ContentWidthContext.Provider value={{ isContentWide, setIsContentWide }}>
      {children}
    </ContentWidthContext.Provider>
  );
}

export function useContentWidth() {
  return useContext(ContentWidthContext);
}

/**
 * 탭별 콘텐츠 너비를 설정하는 훅
 * mount 시 wide 적용, unmount 시 채널 기본값으로 복원
 */
export function useSyncContentWidth(isWide: boolean, channelDefault: boolean) {
  const { setIsContentWide } = useContentWidth();

  useEffect(() => {
    setIsContentWide(isWide);
    return () => setIsContentWide(channelDefault);
  }, [isWide, channelDefault, setIsContentWide]);
}
