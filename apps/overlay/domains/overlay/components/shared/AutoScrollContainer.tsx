'use client';

import { useRef, useEffect, type ReactNode } from 'react';

interface AutoScrollContainerProps {
  /** false면 wrapper만 둘 뿐 아무 동작도 하지 않는다. */
  enabled: boolean;
  /** 스크롤 속도(px/frame). */
  speed?: number;
  children: ReactNode;
  className?: string;
}

/**
 * 자식 트리에서 실제 스크롤 컨테이너를 찾아 콘텐츠를 무한 continuous loop로
 * 흘려보내는 wrapper.
 *
 * 동작:
 * - 자식 트리에서 `[data-overlay-scroll]` 또는 첫 번째 `overflow-y: auto|scroll`
 *   자손을 자동 탐색 (explicit 마커가 있으면 무거운 fallback 스킵)
 * - target.scrollHeight > clientHeight일 때만 동작 (즉 콘텐츠가 컨테이너를 넘을
 *   때만)
 * - 동작 시 target의 자식 노드들을 한번 더 cloneNode로 복제 추가하고,
 *   scrollTop 대신 자식 transform만 이동시켜 reset 점프가 시각적으로 안
 *   보이게 한다 (= 끝없이 밑으로 쭉 흐르는 효과)
 * - React가 자식 children을 업데이트하면 MutationObserver가 감지하여 clone을
 *   재구성. target이 살아있으면 mutation callback에서 즉시 return하여
 *   불필요한 querySelectorAll/getComputedStyle 비용을 회피.
 */
export function AutoScrollContainer({
  enabled,
  speed = 0.5,
  children,
  className,
}: AutoScrollContainerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let frame: number | null = null;
    let target: HTMLElement | null = null;
    let originalHeight = 0;
    let offset = 0;
    let prevTargetOverflow = '';
    let isManagingDom = false;
    let pendingSetupHandle: number | null = null;

    const findScrollTarget = (): HTMLElement | null => {
      // Explicit 마커는 거의 모든 큐 테마에 있으므로 fast path만 거의 항상 탄다.
      const explicit = wrapper.querySelector<HTMLElement>(
        '[data-overlay-scroll]',
      );
      if (explicit) return explicit;
      // Fallback: 마커 없는 테마(placeholder/ticker 등)에서만 도달.
      // querySelectorAll('*')+getComputedStyle은 무거우므로 setupTarget의
      // "target이 살아있으면 재탐색 스킵" 가드로 mutation마다 재호출되는 것을
      // 막는다.
      const all = wrapper.querySelectorAll<HTMLElement>('*');
      for (const el of all) {
        const style = window.getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return el;
        }
      }
      return null;
    };

    const removeClones = (el: HTMLElement) => {
      const clones = el.querySelectorAll('[data-auto-scroll-clone="1"]');
      clones.forEach((c) => c.remove());
    };

    const clearAnimatedChildren = (el: HTMLElement) => {
      Array.from(el.children).forEach((child) => {
        if (!(child instanceof HTMLElement)) return;
        child.style.transform = '';
        child.style.willChange = '';
      });
    };

    const teardownTarget = () => {
      if (!target) return;
      clearAnimatedChildren(target);
      removeClones(target);
      target.style.overflow = prevTargetOverflow;
      target = null;
      originalHeight = 0;
      offset = 0;
    };

    const rebuildClones = (el: HTMLElement) => {
      // el 안에 살아있는 (data-auto-scroll-clone이 아닌) 자식들을 통째로
      // 복제하여 끝에 추가. setupTarget에서도, mutation으로 인한 재구성에서도
      // 동일 로직을 쓴다.
      const realChildren = Array.from(el.children).filter(
        (c) => !(c instanceof HTMLElement && c.dataset.autoScrollClone === '1'),
      );
      realChildren.forEach((child) => {
        const clone = child.cloneNode(true) as HTMLElement;
        clone.setAttribute('data-auto-scroll-clone', '1');
        clone.setAttribute('aria-hidden', 'true');
        // 클론 안의 모든 input/animation 등 ID 충돌 방지: id 제거
        clone.removeAttribute('id');
        clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
        el.appendChild(clone);
      });
    };

    const setupTarget = () => {
      if (isManagingDom) return;
      isManagingDom = true;
      try {
        // target이 여전히 살아있으면 재탐색 없이 클론만 재구성한다.
        // (큐 항목 추가/삭제 → 콘텐츠 높이 변경 시의 일반 경로)
        if (target && wrapper.contains(target)) {
          clearAnimatedChildren(target);
          removeClones(target);
          offset = 0;

          const fullHeight = target.scrollHeight;
          if (fullHeight <= target.clientHeight) {
            // 더 이상 스크롤 필요 없음 → originalHeight=0이면 tick은 noop
            originalHeight = 0;
            return;
          }
          originalHeight = fullHeight;
          rebuildClones(target);
          return;
        }

        // target이 unmount되었거나 아직 없음 → 재탐색 (무거운 fallback 가능)
        teardownTarget();
        const next = findScrollTarget();
        if (!next) return;
        target = next;

        // 콘텐츠가 컨테이너를 안 넘으면 스크롤 불필요
        const fullHeight = target.scrollHeight;
        if (fullHeight <= target.clientHeight) return;

        prevTargetOverflow = target.style.overflow;
        target.style.overflow = 'hidden';

        // 첫 set의 자식들을 통째로 복제하여 추가 → 끝에 도달했을 때 같은
        // 콘텐츠가 보이므로 reset 점프가 안 보임
        originalHeight = fullHeight;
        rebuildClones(target);
      } finally {
        // mutation events for our own clone insertion settle, then unlock
        setTimeout(() => {
          isManagingDom = false;
        }, 0);
      }
    };

    const scheduleSetup = () => {
      if (pendingSetupHandle !== null) return;
      pendingSetupHandle = window.setTimeout(() => {
        pendingSetupHandle = null;
        setupTarget();
      }, 50);
    };

    // 초기 탐색
    setupTarget();

    // React가 children을 갱신하면 (큐 추가/삭제, 테마 전환 등) clone이 stale
    // 해지므로 재구성한다. 우리가 추가한 clone 자체의 mutation은 isManagingDom
    // 가드로 무시. setupTarget 안에서 target이 살아있는지 확인해 살아있으면
    // querySelectorAll/getComputedStyle fallback 호출을 스킵한다.
    const observer = new MutationObserver(() => {
      if (isManagingDom) return;
      scheduleSetup();
    });
    observer.observe(wrapper, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    const tick = () => {
      if (target && originalHeight > 0) {
        offset += speed;
        if (offset >= originalHeight) {
          offset -= originalHeight;
        }
        const translate = `translate3d(0, -${offset}px, 0)`;
        Array.from(target.children).forEach((child) => {
          if (!(child instanceof HTMLElement)) return;
          child.style.transform = translate;
          child.style.willChange = 'transform';
        });
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (pendingSetupHandle !== null) {
        clearTimeout(pendingSetupHandle);
      }
      observer.disconnect();
      // teardown은 isManagingDom 플래그를 무시하고 강제 정리
      isManagingDom = true;
      teardownTarget();
      isManagingDom = false;
    };
  }, [enabled, speed]);

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={{ width: '100%', height: '100%' }}
    >
      {children}
    </div>
  );
}
