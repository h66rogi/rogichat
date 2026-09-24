'use client';

import { useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  resolveTextStroke,
  buildTextStrokeStyle,
} from '@/domains/overlay/themes/shared/text-stroke';

interface Props {
  options: Record<string, unknown> | null | undefined;
  children: ReactNode;
}

/**
 * 위젯 트리 최상단에서 `text-shadow` (drop-letter 오프셋) 를 한 번 깔아두는
 * wrapper. `text-shadow` 는 inherited 속성이라, 자체적으로 `text-shadow` 를
 * 덮어쓰지 않는 모든 자손 텍스트가 자동으로 drop-letter 를 받게 된다.
 *
 * 이 한 곳에서 inject 하면 14 개 테마의 모든 위젯 (now-playing / queue /
 * chatbox / setlist / lyrics) 이 별도 plumbing 없이 동일하게 동작.
 *
 * 자체 `text-shadow` 를 leaf 에 정의하는 테마(billboard / neon-cyberpunk /
 * retro-pixel / concert-poster / 3d-depth / vinyl-analog)에서는 leaf
 * override 가 wrapper 의 inherited 값을 덮어쓴다 — 이 경우엔 해당 위젯이
 * 자기 textShadow 사이트마다 `withTextStroke` 로 합쳐 stroke 를 보존해야
 * 한다 (billboard 는 이미 그렇게 처리되어 있음).
 */
export function TextStrokeWrapper({ options, children }: Props) {
  const stroke = resolveTextStroke(options);
  const style: CSSProperties = useMemo(
    () => ({
      width: '100%',
      height: '100%',
      ...buildTextStrokeStyle(stroke),
    }),
    [stroke.enabled, stroke.color, stroke.width],
  );
  return <div style={style}>{children}</div>;
}
