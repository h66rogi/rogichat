'use client';

import { memo } from 'react';

type LiquidGlassFilterProps = {
  id: string;
  refraction?: number;
  noiseFrequency?: number;
};

/**
 * Inline SVG filter that mimics Apple's iOS 26 "Liquid Glass" refraction.
 *
 * Pipeline:
 *   feTurbulence → feGaussianBlur → feDisplacementMap (refracts the backdrop)
 *     → feColorMatrix (saturate boost) → mild post-blur
 *
 * Consumed by CSS via `backdrop-filter: url(#<id>) blur(…) saturate(…)`.
 * Works in Chromium-based browsers (including OBS's CEF runtime, which is
 * what streamers actually load overlay URLs into). Safari/Firefox silently
 * ignore the `url()` portion and fall back to the plain blur+saturate
 * specified alongside it via `-webkit-backdrop-filter`.
 */
function LiquidGlassFilter({
  id,
  refraction = 48,
  noiseFrequency = 0.012,
}: LiquidGlassFilterProps) {
  return (
    <svg
      data-liquid-glass-filter
      aria-hidden
      focusable={false}
      width="0"
      height="0"
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        pointerEvents: 'none',
        opacity: 0,
      }}
    >
      <defs>
        <filter
          id={id}
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency={`${noiseFrequency} ${noiseFrequency * 1.4}`}
            numOctaves="2"
            seed="9"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="1.4" result="smoothed" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="smoothed"
            scale={refraction}
            xChannelSelector="R"
            yChannelSelector="G"
            result="displaced"
          />
          <feColorMatrix
            in="displaced"
            type="saturate"
            values="1.9"
            result="saturated"
          />
          <feGaussianBlur in="saturated" stdDeviation="0.5" />
        </filter>
      </defs>
    </svg>
  );
}

LiquidGlassFilter.displayName = 'LiquidGlassFilter';
export default memo(LiquidGlassFilter);
