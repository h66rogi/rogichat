'use client';

import { useMemo, memo} from 'react';
import type { ThemeWidgetProps } from '../types';
import { buildFontFamilyValue, useCommonOptions, useQueueAnimation } from '../shared';
import { hexToRgba, withOpacity, buildBlurFilter } from '../shared/apply-transparency';
import { defaultOptions, type VinylAnalogOptions } from './config';
import type { SongRequest } from '../../types/overlay';

type Props = ThemeWidgetProps;

function resolveOptions(raw: Record<string, unknown>): VinylAnalogOptions {
  return {
    ...defaultOptions,
    ...(raw as Partial<VinylAnalogOptions>),
  };
}

function getTitle(item: SongRequest): string {
  return item.song?.title || item.rawTitle || 'Untitled';
}

function getArtist(item: SongRequest): string {
  return item.song?.artist?.name || item.rawArtist || '';
}

function Queue({
  data,
  options: rawOptions,
  animations,
  fonts,
  reducedMotion,
}: Props) {
  const options = useMemo(() => resolveOptions(rawOptions), [rawOptions]);
  const common = useCommonOptions(rawOptions);
  const headingFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.heading ?? ['Playfair Display', 'serif']),
    [common.fontFamily, fonts.roles.heading],
  );
  const bodyFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.body ?? ['Lora', 'serif']),
    [common.fontFamily, fonts.roles.body],
  );
  const accentFont = useMemo(
    () => common.fontFamily ?? buildFontFamilyValue(fonts.roles.accent ?? ['Lora', 'serif']),
    [common.fontFamily, fonts.roles.accent],
  );

  const queue = useMemo(() => data?.queue ?? [], [data?.queue]);

  const { animatedItems } = useQueueAnimation<SongRequest>({
    items: queue,
    getItemId: (item) => String(item.id),
    addAnimation: animations['queue.add'],
    removeAnimation: animations['queue.remove'],
    reducedMotion,
  });

  const discColor = options.discColor || defaultOptions.discColor;
  const labelColor = options.labelColor || defaultOptions.labelColor;
  const accentColor = common.accentColor ?? options.accentColor ?? defaultOptions.accentColor;
  const bgColor = options.backgroundColor || defaultOptions.backgroundColor;
  const textColor = common.textColor ?? options.textColor ?? defaultOptions.textColor;

  const enterDuration = animations['queue.add']?.enterDuration ?? 500;
  const stagger = animations['queue.add']?.stagger ?? 80;

  const containerStyle: React.CSSProperties = useMemo(() => ({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: bodyFont,
    fontWeight: common.fontWeight,
    color: textColor,
    background: 'transparent',
    boxSizing: 'border-box',
  }), [bodyFont, common.textSizeMultiplier, common.fontWeight, textColor]);

  const frameStyle: React.CSSProperties = useMemo(() => ({
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    backgroundColor: hexToRgba(bgColor, common.backgroundOpacity),
    backgroundImage: [
      `radial-gradient(ellipse at 30% 20%, rgba(255, 220, 180, 0.08), transparent 55%)`,
      `repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.05) 0px, rgba(0, 0, 0, 0.05) 1px, transparent 1px, transparent 5px)`,
    ].join(', '),
    border: `1px solid ${withOpacity(accentColor, common.borderOpacity * 0.25)}`,
    borderRadius: 12,
    padding: '22px 26px',
    position: 'relative',
    boxShadow: [
      'inset 0 1px 0 rgba(255, 230, 190, 0.08)',
      'inset 0 0 40px rgba(0, 0, 0, 0.45)',
    ].join(', '),
    overflow: 'hidden',
    boxSizing: 'border-box',
    backdropFilter: buildBlurFilter(common.blurIntensity),
    WebkitBackdropFilter: buildBlurFilter(common.blurIntensity),
  }), [accentColor, bgColor, common.backgroundOpacity, common.borderOpacity, common.blurIntensity]);

  const headerStyle: React.CSSProperties = useMemo(() => ({
    fontFamily: accentFont,
    fontSize: common.scale(13),
    fontStyle: 'italic',
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: accentColor,
    marginBottom: 14,
    paddingBottom: 10,
    borderBottom: `1px solid ${accentColor}33`,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  }), [accentColor, accentFont, common.textSizeMultiplier]);

  const isEmpty = queue.length === 0;

  // A smaller decorative disc used in each queue row — not animated per item
  // (too many spins would read as chaos); just a static record silhouette.
  const renderMiniDisc = () => (
    <div
      aria-hidden="true"
      style={{
        position: 'relative',
        width: 32,
        height: 32,
        flexShrink: 0,
        borderRadius: '50%',
        backgroundImage: [
          `radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.1), transparent 60%)`,
          `conic-gradient(from 0deg, ${discColor}, #2a2a2a, ${discColor}, #2a2a2a, ${discColor}, #2a2a2a, ${discColor})`,
        ].join(', '),
        backgroundColor: discColor,
        boxShadow: [
          'inset 0 0 0 1px rgba(255, 255, 255, 0.08)',
          'inset 0 0 6px rgba(0, 0, 0, 0.6)',
          '0 2px 6px rgba(0, 0, 0, 0.5)',
        ].join(', '),
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 14,
          height: 14,
          marginTop: -7,
          marginLeft: -7,
          borderRadius: '50%',
          backgroundImage: `radial-gradient(circle at 40% 35%, ${labelColor}, ${labelColor}cc 60%)`,
          backgroundColor: labelColor,
          boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.35)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 2,
          height: 2,
          marginTop: -1,
          marginLeft: -1,
          borderRadius: '50%',
          backgroundColor: '#0a0605',
        }}
      />
    </div>
  );

  return (
    <div style={containerStyle}>
      <div style={frameStyle}>
        <div style={headerStyle}>
          <span aria-hidden="true">{'\u266B'}</span>
          <span>Up Next</span>
          <span
            style={{
              marginLeft: 'auto',
              fontSize: common.scale(12),
              letterSpacing: 2,
              opacity: 0.7,
              color: textColor,
              fontStyle: 'normal',
            }}
          >
            {(data?.queue ?? []).length} record
            {(data?.queue ?? []).length === 1 ? '' : 's'}
          </span>
        </div>

        {isEmpty ? (
          <div
            style={{
              fontFamily: bodyFont,
              fontStyle: 'italic',
              fontSize: common.scale(13),
              color: textColor,
              opacity: 0.55,
              padding: '20px 4px',
              textAlign: 'center',
            }}
          >
            No records queued
          </div>
        ) : (
          <ul data-overlay-scroll
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            {animatedItems.map(({ item, phase, index }) => {
              const isDonation = (item.donationAmount ?? 0) > 0;
              const isHomework = !!item.isHomework;

              const isRandom = !!item.isRandom;

              const animationCss =
                phase === 'entering' && !reducedMotion
                  ? `vinyl-analog-record-slide ${enterDuration}ms cubic-bezier(0.22, 1, 0.36, 1) ${
                      stagger * index
                    }ms 1 both`
                  : undefined;

              return (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    backgroundColor: isDonation
                      ? `${accentColor}18`
                      : 'rgba(0, 0, 0, 0.22)',
                    border: `1px solid ${
                      isDonation ? `${accentColor}66` : `${accentColor}22`
                    }`,
                    borderRadius: 6,
                    animation: animationCss,
                  }}
                >
                  {renderMiniDisc()}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: headingFont,
                        fontSize: common.scale(18),
                        fontWeight: 700,
                        color: textColor,
                        lineHeight: 1.25,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getTitle(item)}
                    </div>
                    <div
                      style={{
                        fontFamily: bodyFont,
                        fontSize: common.scale(16),
                        fontStyle: 'italic',
                        color: accentColor,
                        opacity: 0.85,
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {getArtist(item)}
                      {data.settings?.showRequesterName !== false && item.requesterNickname ? (
                        <span
                          style={{
                            opacity: 0.7,
                            fontStyle: 'normal',
                          }}
                        >
                          {' '}
                          &middot; @{item.requesterNickname}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {isDonation && (
                    <span
                      style={{
                        fontFamily: accentFont,
                        fontSize: common.scale(11),
                        fontStyle: 'italic',
                        color: accentColor,
                        border: `1px solid ${accentColor}88`,
                        padding: '2px 6px',
                        borderRadius: 3,
                        letterSpacing: 1,
                        flexShrink: 0,
                      }}
                    >
                      DON
                    </span>
                  )}
                  {isHomework && (
                    <span
                      style={{
                        fontFamily: accentFont,
                        fontSize: common.scale(11),
                        fontStyle: 'italic',
                        color: labelColor,
                        border: `1px solid ${labelColor}88`,
                        padding: '2px 6px',
                        borderRadius: 3,
                        letterSpacing: 1,
                        flexShrink: 0,
                      }}
                    >
                      HW
                    </span>
                  )}

                  {isRandom && (
                    <span
                      style={{
                        fontFamily: accentFont,
                        fontSize: common.scale(11),
                        fontStyle: 'italic',
                        color: labelColor,
                        border: `1px solid ${labelColor}88`,
                        padding: '2px 6px',
                        borderRadius: 3,
                        letterSpacing: 1,
                        flexShrink: 0,
                      }}
                    >
                      HW
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
Queue.displayName = 'Queue';
export default memo(Queue);
