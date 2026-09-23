"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  PreviewError,
  previewToPng,
  type PreviewErrorCode,
} from "@/meloming/domains/schedule-template/utils/preview-to-png";

/** 디바운스 딜레이 — 사용자 편집 후 ~500ms 안정화되면 PNG 재생성. */
const DEFAULT_DEBOUNCE_MS = 500;

interface UsePreviewPngOptions {
  /** false 면 자동 생성 비활성. 기본 true. */
  enabled?: boolean;
  /** 디바운스 ms. 기본 500. */
  debounceMs?: number;
  /** 출력 픽셀 비율. 기본 1. */
  pixelRatio?: number;
  /** PNG 배경색. */
  backgroundColor?: string;
  /**
   * SVG viewBox / 렌더 노드에 강제 적용할 폭 (px). html-to-image `width`.
   * 디자인 좌표계 자연 폭(=baseImageW) 을 넣으면 모든 슬롯이 짤리지 않고
   * SVG 에 그려진다.
   */
  width?: number;
  /** SVG viewBox / 렌더 노드에 강제 적용할 높이 (px). */
  height?: number;
  /**
   * 결과 PNG 캔버스 폭 (px). html-to-image `canvasWidth`. 미지정 시 width 동일.
   * baseImageW 보다 작은 값을 주면 SVG 가 자연 좌표로 렌더된 뒤 캔버스에
   * 다운샘플되어 그려진다 — 슬롯이 짤리지 않으면서 더 작은 PNG.
   */
  canvasWidth?: number;
  /** 결과 PNG 캔버스 높이 (px). */
  canvasHeight?: number;
}

interface UsePreviewPngResult {
  /** Object URL — `<img src>` 등에 바로 쓸 수 있다. */
  blobUrl: string | null;
  /** 가장 최근 PNG Blob. 다운로드 트리거 등에 사용. */
  blob: Blob | null;
  /** PNG 생성 중 여부. */
  isGenerating: boolean;
  /** 에러 코드 (CORS/EMPTY/RENDER_FAILED) 또는 null. */
  errorCode: PreviewErrorCode | null;
  /** 디바운스 무시하고 즉시 1회 재생성. */
  regenerate: () => void;
}

/**
 * `nodeRef` 가 가리키는 DOM 노드를 ~500ms 디바운스로 PNG Blob 으로 변환한다.
 *
 *  - `triggerKey` 가 바뀔 때마다 디바운스 후 재생성 (예: 슬롯 편집/주차 변경/
 *    템플릿 교체 시).
 *  - `enabled=false` 시 즉시 cleanup + null 반환.
 *  - 컴포넌트 언마운트 / 다음 trigger 도달 시 이전 ObjectURL 자동 해제 (메모리 누수 방지).
 *  - CORS 에러는 toast 등 UX 처리 위해 errorCode 로 surfaces.
 */
export function usePreviewPng(
  nodeRef: RefObject<HTMLElement | null>,
  triggerKey: unknown,
  options?: UsePreviewPngOptions,
): UsePreviewPngResult {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const enabled = options?.enabled ?? true;

  const [blob, setBlob] = useState<Blob | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorCode, setErrorCode] = useState<PreviewErrorCode | null>(null);

  // 진행 중인 생성을 식별하기 위한 토큰. 새 trigger 가 들어오면 token 을 올리고
  // 이전 비동기 작업의 결과는 무시한다.
  const generationTokenRef = useRef(0);
  // 현재 보유 중인 ObjectURL — 다음 set 시점 / 언마운트 시 해제.
  const currentBlobUrlRef = useRef<string | null>(null);

  const replaceBlob = useCallback((next: Blob | null) => {
    // 이전 ObjectURL 해제.
    if (currentBlobUrlRef.current !== null) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
    setBlob(next);
    if (next === null) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(next);
    currentBlobUrlRef.current = url;
    setBlobUrl(url);
  }, []);

  const generate = useCallback(async () => {
    const node = nodeRef.current;
    if (!node) return;
    const token = ++generationTokenRef.current;
    setIsGenerating(true);
    setErrorCode(null);
    try {
      const result = await previewToPng(node, {
        pixelRatio: options?.pixelRatio,
        backgroundColor: options?.backgroundColor,
        width: options?.width,
        height: options?.height,
        canvasWidth: options?.canvasWidth,
        canvasHeight: options?.canvasHeight,
      });
      // 도중에 새 trigger 가 들어왔다면 이 결과는 stale.
      if (token !== generationTokenRef.current) return;
      replaceBlob(result);
    } catch (error) {
      if (token !== generationTokenRef.current) return;
      if (error instanceof PreviewError) {
        setErrorCode(error.code);
      } else {
        setErrorCode("RENDER_FAILED");
      }
    } finally {
      if (token === generationTokenRef.current) {
        setIsGenerating(false);
      }
    }
  }, [
    nodeRef,
    options?.pixelRatio,
    options?.backgroundColor,
    options?.width,
    options?.height,
    options?.canvasWidth,
    options?.canvasHeight,
    replaceBlob,
  ]);

  // triggerKey 변화 → 디바운스 후 generate. enabled=false 면 cleanup.
  //
  // ⚠ in-flight toBlob 도중에 enabled 가 false 가 되면 generationToken 이 bump 되어
  // generate() 의 finally 가 setIsGenerating(false) 를 건너뛴다 — 결과적으로
  // isGenerating 이 true 로 누수된다 (Codex F9 MINOR). 비활성 분기에서 명시적으로
  // setIsGenerating(false) 해서 누수를 막는다.
  useEffect(() => {
    if (!enabled) {
      // 비활성 시 진행 중 작업 취소 + blob 해제 + 생성 상태 해제.
      generationTokenRef.current++;
      replaceBlob(null);
      setIsGenerating(false);
      return;
    }
    const timer = setTimeout(() => {
      void generate();
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [triggerKey, enabled, debounceMs, generate, replaceBlob]);

  // 언마운트 시 ObjectURL 해제.
  useEffect(() => {
    return () => {
      if (currentBlobUrlRef.current !== null) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
        currentBlobUrlRef.current = null;
      }
    };
  }, []);

  const regenerate = useCallback(() => {
    void generate();
  }, [generate]);

  return {
    blob,
    blobUrl,
    isGenerating,
    errorCode,
    regenerate,
  };
}
