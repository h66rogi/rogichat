'use client';
import { useCallback, useState } from 'react';

/**
 * 단일 이미지 페이지를 그리는 dumb renderer. zoom / pan / swipe / double-tap 은
 * 부모 SheetMusicCanvas 가 처리. 여기서는 자연 크기와 무관하게 viewport 안에
 * 비율 유지 fit (max-w-full / max-h-full + object-contain) 만 책임진다.
 *
 * rotation 은 image 자체 transform 으로 처리. SheetMusicCanvas 의 zoom transform
 * 과 곱해져 적용된다.
 */
export interface ImageViewerProps {
  url: string;
  rotation: number;
}

export function ImageViewer({ url, rotation }: ImageViewerProps) {
  const [error, setError] = useState(false);
  const onError = useCallback(() => setError(true), []);

  if (error) {
    return (
      <div className="text-center p-8 text-destructive">
        이미지를 불러올 수 없습니다.
      </div>
    );
  }
  // next/image 로 교체는 CDN 호스트 화이트리스트 + 그 외 옵션 필요. 2차 백로그.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="악보"
      referrerPolicy="no-referrer"
      style={{
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center',
      }}
      className="max-w-full max-h-full object-contain select-none"
      draggable={false}
      onError={onError}
    />
  );
}
