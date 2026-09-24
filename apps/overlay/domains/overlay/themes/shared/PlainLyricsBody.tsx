'use client';

import type { CSSProperties } from 'react';

interface Props {
  body: string;
  fontSize: number;
  color: string;
  fontFamily?: string;
  fontWeight?: number;
  cardStyle?: CSSProperties;
}

/**
 * synced lyrics 가 없는 OK 응답 — plain body 텍스트 그대로 노출.
 * 14개 테마가 자기 cardStyle 을 spread 하여 톤 유지.
 * 스크롤 가능한 컨테이너로 긴 가사도 OBS 안에서 휠 없이 자동 fit.
 */
export function PlainLyricsBody({ body, fontSize, color, fontFamily, fontWeight, cardStyle }: Props) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div
        style={{
          ...(cardStyle ?? {}),
          fontSize,
          color,
          fontFamily,
          fontWeight,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          textAlign: 'center',
          padding: 24,
          overflow: 'auto',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
        }}
      >
        {body}
      </div>
    </div>
  );
}
