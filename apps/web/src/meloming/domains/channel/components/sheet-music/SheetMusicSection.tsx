'use client';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import { useFeatureFlag } from '@/meloming/shared/hooks/use-feature-flag';
import {
  deleteSongsChannelIdentifierSongIdSheetMusicSlot,
  patchSongsChannelIdentifierSongIdSheetMusicReorder,
} from '@/meloming/domains/channel/apis/songs';
import { extractApiErrorMessage } from '@/meloming/shared/lib/api-error';
import { cn } from '@/meloming/shared/lib/utils';
import { detectSheetMusicType, type SheetMusicType } from './utils/detectSheetMusicType';
import { SheetMusicUploader } from './SheetMusicUploader';
import { SheetMusicViewer } from './SheetMusicViewer';
import { SheetMusicToolbar } from './SheetMusicToolbar';
import { useLastViewState } from './hooks/useLastViewState';
import { useSheetMusicShortcuts } from './hooks/useSheetMusicShortcuts';
import type { SheetMusicSlot } from '@/meloming/domains/channel/types/song';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/meloming/shared/components/ui/alert-dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/meloming/shared/components/ui/collapsible';
import { SectionErrorBoundary } from '@/meloming/shared/components/common/error-boundary';
import { SheetMusicDropzone } from './SheetMusicDropzone';
import { SheetMusicThumbnailStrip } from './SheetMusicThumbnailStrip';

const MAX_SIZE = 30 * 1024 * 1024;

export interface SheetMusicSectionProps {
  /**
   * 업로드/삭제 API 경로 파라미터. Round 2 새 endpoint 는 channel-scoped 이므로
   * SongFormV2, 리모콘, music-modal 모두에서 명시적으로 넘겨야 한다.
   *
   * mode === 'pending' (신규 곡 생성 흐름) 에서는 songId 가 아직 존재하지 않으므로
   * 업로드/삭제 호출 자체를 하지 않는다. 이때 songId 는 0(또는 임의의 placeholder)로
   * 호출자가 넘겨도 무방하다.
   */
  channelIdentifier: string;
  songId: number;
  /**
   * Phase 2 — 새 다중 슬롯 contract. sortOrder 오름차순으로 정렬된 array.
   * 호출자가 song detail 의 `sheetMusics` 필드를 그대로 전달.
   */
  initialSlots?: SheetMusicSlot[] | null;
  /**
   * @deprecated Phase 2C 에서 제거. legacy 단일 contract — `initialSlots` 가
   * undefined 일 때만 fallback 으로 사용 (=> 첫 슬롯 1개 생성).
   */
  initialUrl?: string | null;
  /**
   * @deprecated Phase 2C 에서 제거. legacy 단일 type.
   */
  initialType?: SheetMusicType | null;
  canManage: boolean;
  /**
   * 슬롯이 추가/삭제/재정렬된 뒤 호출된다. 부모는 invalidateQueries 만 트리거.
   * (legacy 호출자 호환을 위해 url/type 도 첫 슬롯 평탄화하여 함께 전달.)
   */
  onChange?: (next: {
    slots: SheetMusicSlot[];
    url: string | null;
    type: SheetMusicType | null;
  }) => void;
  /**
   * 'immediate' (default): songId 존재. 업로드/삭제는 즉시 server endpoint 호출.
   * 'pending': 신규 곡 생성 폼. songId 가 아직 없으므로 file 만 메모리에 보관하고
   *  client-side preview (URL.createObjectURL) 로 시각화한다. 실제 업로드는
   *  부모(폼 submit)가 song POST 후 직접 수행한다.
   */
  mode?: 'immediate' | 'pending';
  /**
   * mode === 'pending' 일 때 부모가 보관 중인 임시 파일.
   * undefined 이면 uploader 표시.
   */
  pendingFile?: File | null;
  /**
   * mode === 'pending' 일 때 사용자가 파일을 선택/제거하면 호출.
   */
  onPendingFileChange?: (file: File | null) => void;
  /**
   * true이면 기존 악보 viewer만 렌더한다. 업로드/삭제 UI는 숨기며,
   * 등록된 악보가 없으면 섹션 자체를 렌더하지 않는다.
   */
  readOnly?: boolean;
  /**
   * 라이브 콘솔 사이드 패널처럼 좁은 컨테이너용 표시. 헤더 라벨/Collapsible 토글을
   * 생략해 cognitive load 와 vertical 공간을 절감하고, Toolbar 도 compact 모드로
   * 핵심 6개 버튼만 노출한다. 라이브 중 안 쓰는 항목으로 시야를 차지하지 않게.
   */
  compact?: boolean;
  /**
   * P2: 다운로드 filename 정규화에 사용. 미지정 시 S3 key (nanoid) 가 그대로
   * 노출되어 사용자에게 무의미하고 보안상 표면도 늘어남. 호출자가 곡 제목을
   * 넘기면 `${songTitle}-악보.${ext}` 형태로 친화적인 이름으로 저장.
   */
  songTitle?: string | null;
}

// legacy 단일 url/type → 단일 슬롯 array 로 변환. id 가 없으면 placeholder
// (0). Phase 2 신 contract 로 전환 후 id 기반 작업이 필요해지면 호출자가
// initialSlots 를 직접 넘기도록 마이그레이션해야 한다.
function legacyToSlots(
  url: string | null | undefined,
  type: SheetMusicType | null | undefined,
): SheetMusicSlot[] {
  if (!url || !type) return [];
  return [
    {
      id: 0,
      url,
      type,
      fileName: null,
      fileSize: null,
      sortOrder: 0,
    },
  ];
}

export function SheetMusicSection({
  channelIdentifier,
  songId,
  initialSlots,
  initialUrl,
  initialType,
  canManage,
  onChange,
  mode = 'immediate',
  pendingFile,
  onPendingFileChange,
  readOnly = false,
  compact = false,
  songTitle = null,
}: SheetMusicSectionProps) {
  const flagOn = useFeatureFlag('songbookSheetMusic');
  // Phase 2 — 다중 슬롯 state. initialSlots 가 있으면 우선, 없으면 legacy 단일
  // 필드에서 변환. 빈 배열 = 슬롯 없음.
  const [slots, setSlots] = useState<SheetMusicSlot[]>(
    initialSlots && initialSlots.length > 0
      ? initialSlots
      : legacyToSlots(initialUrl, initialType),
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  // 현재 슬롯의 url/type — 기존 single contract 코드가 의존하던 값들.
  const currentSlot = slots[currentIndex] ?? null;
  const url = currentSlot?.url ?? null;
  const type = currentSlot?.type ?? null;
  const [totalPages, setTotalPages] = useState<number | undefined>(undefined);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  // I4(문제2): 악보 삭제 confirm dialog open 상태.
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  // Phase 2: 슬롯 "추가" 모드. true 면 viewer 대신 SheetMusicUploader 가 노출되어
  // 새 슬롯을 곡에 추가한다. 백엔드 append endpoint 가 호출되며 곡당 캡 10장.
  // 추가는 기존 슬롯에 영향 없으므로 confirm dialog 불필요 (Phase 1.5 의 교체
  // 흐름과 다름).
  const [isAddMode, setIsAddMode] = useState(false);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  // Collapsible (접기/펼치기). 라이브 연주 중 악보가 길면 스크롤 부담이라 사용자가
  // 닫고 다른 패널 (가사 등) 만 볼 수 있게. songId 가 바뀌면 SheetMusicSection 자체가
  // key 로 재마운트되므로 default true 로도 곡마다 자연스럽게 펼쳐진 상태로 시작.
  const [isOpen, setIsOpen] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  // B4: fullscreen 진입 직전 active element 를 보관 → 종료 시 포커스 복귀.
  // ESC/F12/사용자 시스템 단축키로 빠져나오는 경로 모두 커버.
  const fullscreenReturnFocusRef = useRef<HTMLElement | null>(null);
  const { state, update } = useLastViewState(songId);
  // B1: 페이지/줌/회전/맞춤모드 변경을 스크린리더에 announce 하기 위한 polite live
  // region 텍스트. 핸들러 안에서 직접 setAnnounce 로 trigger.
  const [announce, setAnnounce] = useState('');

  // pending 모드: 부모로부터 받은 File 을 client-side blob URL 로 preview.
  // file 이 바뀌거나 unmount 시 createObjectURL 정리.
  useEffect(() => {
    if (mode !== 'pending' || !pendingFile) {
      setPendingPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(pendingFile);
    setPendingPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [mode, pendingFile]);

  // pending 모드: file → 추정 type. detect 함수가 null 이면 사용자에게 즉시 안내.
  const pendingType: SheetMusicType | null = pendingFile
    ? detectSheetMusicType(pendingFile.type, pendingFile.name)
    : null;

  // M1: print 핸들러 / 단축키 enable 판정에 쓰는 "현재 활성 viewer" 의 url/type.
  // immediate 모드면 server URL, pending 모드면 blob URL. 이 분기를 하지 않으면
  // pending 미리보기에서 P 단축키, 인쇄 버튼이 동작하지 않음.
  const activeUrl = mode === 'pending' ? pendingPreviewUrl : url;
  const activeType = mode === 'pending' ? pendingType : type;

  // Codex H1 hydrate race fix:
  // 부모가 초기 fetch 로 초기값이 비어 있다가(undefined/null) 나중에 Song detail 을
  // hydrate 하는 케이스가 있다 (MusicModal, LiveConsole). 기존 구현은 useState
  // initializer 만 썼기 때문에 initial prop 이 바뀌어도 state 가 따라가지 않아
  // 악보가 있는데도 업로드 UI 가 남는 문제가 있었다. 이 effect 로 prop 이 바뀔
  // 때마다 재동기화한다.
  //
  // 주의: 사용자가 방금 업로드/삭제한 직후 server refetch 가 아직 안 끝났다면
  // 부모의 initial 값은 stale 일 수 있다. 하지만 성공 시 onChange 가 parent 에서
  // invalidateQueries 를 돌리므로 곧 최신값으로 수렴한다. 현재 state 도 내부에서
  // 이미 최신이므로 시각적 플릭커 없음.
  // Phase 2 hydrate — initialSlots / legacy 단일 필드 변경 시 slots 재동기화.
  // currentIndex 도 0 으로 리셋 (다른 곡으로 전환되면 첫 슬롯부터).
  useEffect(() => {
    const next =
      initialSlots && initialSlots.length > 0
        ? initialSlots
        : legacyToSlots(initialUrl, initialType);
    setSlots(next);
    setCurrentIndex(0);
  }, [initialSlots, initialUrl, initialType, songId]);

  // onChange callback — slots 변경 시 부모에게 알림. legacy 호출자 호환을 위해
  // 첫 슬롯의 url/type 도 평탄화하여 함께 전달.
  const notifyChange = useCallback(
    (nextSlots: SheetMusicSlot[]) => {
      const first = nextSlots[0];
      onChange?.({
        slots: nextSlots,
        url: first?.url ?? null,
        type: first?.type ?? null,
      });
    },
    [onChange],
  );

  // Phase 2 Step 4 — swipe/키보드 nav 통합:
  //   현재 슬롯 안의 페이지 nav 가 우선. 페이지 끝에 도달하면 다중 슬롯 사이
  //   nav 로 자동 전환 (마지막 페이지에서 next → 다음 슬롯 첫 페이지).
  //   forScore 등 표준 악보 뷰어와 동일 — 책장 넘기듯 자연스럽게 다음 곡으로.
  //   슬롯 이동 시 page=1 reset, zoom/rotation 은 곡 단위라 useLastViewState
  //   가 그대로 유지.
  const onPrev = useCallback(() => {
    if (state.page > 1) {
      const newPage = state.page - 1;
      update({ page: newPage });
      setAnnounce(
        totalPages ? `${newPage} / ${totalPages} 페이지` : `${newPage} 페이지`,
      );
      return;
    }
    if (currentIndex > 0) {
      const prevIdx = currentIndex - 1;
      setCurrentIndex(prevIdx);
      // 이전 슬롯의 마지막 페이지로 가는 게 자연스러우나 totalPages 정보 없음
      // (이전 슬롯이 mount 되어야 PdfViewer 가 onTotalPages 호출). 정책상
      // 1페이지 reset — 사용자가 swipe right 다시 하면 그 안 페이지 이동.
      update({ page: 1 });
      setAnnounce(`슬롯 ${prevIdx + 1} / ${slots.length}`);
    }
  }, [state.page, totalPages, currentIndex, slots.length, update]);
  const onNext = useCallback(() => {
    if (totalPages && state.page < totalPages) {
      const newPage = state.page + 1;
      update({ page: newPage });
      setAnnounce(`${newPage} / ${totalPages} 페이지`);
      return;
    }
    if (!totalPages) {
      // PDF 가 아직 로드 안 된 경우 (Image/MusicXML 등 단일 페이지) — 슬롯 nav.
      if (currentIndex < slots.length - 1) {
        const nextIdx = currentIndex + 1;
        setCurrentIndex(nextIdx);
        update({ page: 1 });
        setAnnounce(`슬롯 ${nextIdx + 1} / ${slots.length}`);
      }
      return;
    }
    // PDF 끝페이지
    if (currentIndex < slots.length - 1) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      update({ page: 1 });
      setAnnounce(`슬롯 ${nextIdx + 1} / ${slots.length}`);
    }
  }, [state.page, totalPages, currentIndex, slots.length, update]);
  const onZoomIn = useCallback(() => {
    const newZoom = Math.min(state.zoom + 0.25, 5);
    update({ zoom: newZoom, fitMode: 'none' });
    setAnnounce(`확대 ${Math.round(newZoom * 100)}%`);
  }, [state.zoom, update]);
  const onZoomOut = useCallback(() => {
    const newZoom = Math.max(state.zoom - 0.25, 0.25);
    update({ zoom: newZoom, fitMode: 'none' });
    setAnnounce(`축소 ${Math.round(newZoom * 100)}%`);
  }, [state.zoom, update]);
  // forScore UX 표준 — fit-width / fit-page 분리는 의미 모호. zoom 1.0 = 페이지
  // 전체 fit (object-contain) 단일 동작으로 통일. toolbar 의 두 버튼은 같은
  // 동작으로 수렴 (button polish 는 Phase 2 정리).
  const onFitWidth = useCallback(() => {
    update({ zoom: 1, fitMode: 'page' });
    setAnnounce('맞춤');
  }, [update]);
  const onFitPage = useCallback(() => {
    update({ zoom: 1, fitMode: 'page' });
    setAnnounce('맞춤');
  }, [update]);
  // SheetMusicCanvas 가 자체 pinch / double-tap 으로 zoom 조정 시 외부 state
  // 동기화. fitMode 는 'none' 진입 (사용자 의도 zoom).
  const onZoomChange = useCallback(
    (newZoom: number) => {
      update({ zoom: newZoom, fitMode: 'none' });
    },
    [update],
  );
  const onRotate = useCallback(() => {
    const newRotation = (state.rotation + 90) % 360;
    update({ rotation: newRotation });
    setAnnounce(`${newRotation}도 회전`);
  }, [state.rotation, update]);
  // C1: viewer 영역에 파일 drag 시 자동으로 교체 confirm 으로 진입.
  // dataTransfer.types 가 "Files" 를 포함할 때만 발화 (텍스트 드래그 등 noise 차단).
  // viewer 자체는 mouse 인터랙션 위해 그대로 두고, drop 한 순간 confirm 으로 의식적
  // 단계를 강제 — 실제 업로드 트리거는 confirm 통과 후 replaceMode 의 명시적 UI 에서.
  const onViewerDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!url || !type || readOnly) return;
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
    },
    [url, type, readOnly],
  );
  const onViewerDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (!url || !type || readOnly) return;
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      e.preventDefault();
      // Phase 2: 추가 모드 진입 — 사용자가 dropzone 에서 같은 파일을 다시
      // 선택하거나 다른 파일로 변경 가능. confirm 불필요 (추가는 기존 슬롯
      // 손실 없음).
      setIsAddMode(true);
    },
    [url, type, readOnly],
  );
  const onDownload = useCallback(async () => {
    if (!activeUrl) return;
    try {
      // CDN 은 cross-origin 이라 a[download] attribute 만으론 강제 다운로드가 안 되는
      // 브라우저가 있어 (Chrome 86+ same-origin enforcement) blob 으로 받아 강제 클릭.
      // CORS 는 upload-cdn-legacy 모듈에서 이미 구성되어 있음.
      const res = await fetch(activeUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      // P2: filename 정규화. activeUrl 의 마지막 segment 는 nanoid 라 사용자에게
      // 무의미. songTitle 이 있으면 친화 이름 사용, 없으면 generic 이름.
      // OS 파일시스템 forbidden 문자는 whitelist 정규식으로 안전 치환.
      const urlPath = activeUrl.split('?')[0] ?? activeUrl;
      const ext = urlPath.split('.').pop()?.toLowerCase() ?? 'pdf';
      const safeTitle = songTitle
        ? songTitle.replace(/[^\p{L}\p{N}\s._-]+/gu, '_').trim()
        : '';
      a.download = safeTitle ? `${safeTitle}-악보.${ext}` : `악보.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, '다운로드에 실패했습니다.'));
    }
  }, [activeUrl, songTitle]);
  const onToggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      // B4: 진입 직전 active element 보관 → fullscreenchange 리스너에서 종료 시 복귀.
      // ESC/시스템 단축키로 빠져나오는 경로도 자동 동기화 처리.
      const active = document.activeElement;
      fullscreenReturnFocusRef.current =
        active instanceof HTMLElement ? active : null;
      void el.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  }, []);

  // B4: fullscreen 실제 상태와 isFullscreen state 의 진실의 원천(source of truth)을
  // 일치시킨다. 사용자가 ESC 키 / 시스템 단축키로 빠져나오는 경우 onToggleFullscreen
  // 이 호출되지 않아 toolbar 의 Maximize/Minimize 아이콘이 stale 해지고 단축키 F
  // 토글이 어긋난다. document.fullscreenElement 한 곳만 보고 sync.
  useEffect(() => {
    function handleFullscreenChange() {
      const isInFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isInFullscreen);
      if (!isInFullscreen) {
        // 종료 시 진입 전 active element 로 포커스 복귀 (모달 안 fullscreen 진입
        // 후 ESC 로 빠져나오면 body 에 포커스 떨어지는 문제 방지).
        const target = fullscreenReturnFocusRef.current;
        fullscreenReturnFocusRef.current = null;
        if (target && typeof target.focus === 'function') {
          target.focus();
        }
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // M1: 단축키 enable 판정도 active 기준. pending 미리보기에서도 ←/→, +/-,
  // R, P, F 등이 동작.
  // 추가: collapsible 닫혀 있을 땐 단축키 비활성 — 안 보이는 viewer 를 조작하면
  // 사용자 혼란 + window-level keydown 충돌 가능성.
  useSheetMusicShortcuts(!!activeUrl && !!activeType && isOpen, {
    onPrevPage: onPrev,
    onNextPage: onNext,
    onZoomIn,
    onZoomOut,
    onFitWidth,
    onFitPage,
    onRotate,
    onDownload,
    onToggleFullscreen,
  });

  // Phase 2: 현재 슬롯 1개 삭제. 남은 슬롯의 sortOrder 는 그대로 유지 (gap 허용).
  // currentIndex 는 삭제된 위치 → 같은 자리의 다음 슬롯이 표시되도록 그대로 두되,
  // 마지막 슬롯이 삭제되면 인덱스를 한 칸 앞으로 당김.
  const handleDelete = useCallback(async () => {
    if (isDeleting) return;
    if (!currentSlot || currentSlot.id === 0) {
      // legacy hydrate 로 만든 placeholder slot — id 가 없어 backend 호출 불가.
      // 이 케이스는 호출자가 initialSlots 마이그레이션을 끝내면 사라진다.
      toast.error('슬롯 식별자가 없어 삭제할 수 없습니다. 페이지를 새로고침해 주세요.');
      return;
    }
    setIsDeleting(true);
    try {
      await deleteSongsChannelIdentifierSongIdSheetMusicSlot(
        channelIdentifier,
        songId,
        currentSlot.id,
      );
      const nextSlots = slots.filter((s) => s.id !== currentSlot.id);
      setSlots(nextSlots);
      setCurrentIndex((idx) => Math.min(idx, Math.max(0, nextSlots.length - 1)));
      notifyChange(nextSlots);
      setIsDeleteConfirmOpen(false);
    } catch (err) {
      const msg = extractApiErrorMessage(err, '악보 삭제에 실패했습니다.');
      toast.error(msg);
    } finally {
      setIsDeleting(false);
    }
  }, [
    channelIdentifier,
    songId,
    isDeleting,
    currentSlot,
    slots,
    notifyChange,
  ]);

  // Phase 2: 새 슬롯이 backend 에 추가된 후 호출. SheetMusicUploader 가
  // appendSongsChannelIdentifierSongIdSheetMusic 응답을 그대로 넘김.
  // 새 슬롯을 표시하도록 currentIndex 는 추가된 위치로 이동.
  const handleSlotAppended = useCallback(
    (slot: SheetMusicSlot) => {
      setSlots((prev) => {
        const next = [...prev, slot];
        notifyChange(next);
        // 새 슬롯 = 추가 후 마지막 인덱스
        setCurrentIndex(next.length - 1);
        return next;
      });
    },
    [notifyChange],
  );

  // Phase 2: drag-reorder 가 호출. orderedIds 가 새 sortOrder 0..N-1.
  const handleReorder = useCallback(
    async (orderedIds: number[]) => {
      // optimistic — 즉시 로컬 재배열, 실패 시 서버 응답으로 복구
      const idToSlot = new Map(slots.map((s) => [s.id, s]));
      const optimistic = orderedIds
        .map((id, idx) => {
          const s = idToSlot.get(id);
          if (!s) return null;
          return { ...s, sortOrder: idx };
        })
        .filter((s): s is SheetMusicSlot => s !== null);
      setSlots(optimistic);
      try {
        const fresh = await patchSongsChannelIdentifierSongIdSheetMusicReorder(
          channelIdentifier,
          songId,
          orderedIds,
        );
        setSlots(fresh);
        notifyChange(fresh);
      } catch (err) {
        toast.error(extractApiErrorMessage(err, '순서 변경에 실패했습니다.'));
        // rollback to original — slots 그대로 (함수 진입 시 캡쳐된 값) 으로 복원
        setSlots(slots);
      }
    },
    [channelIdentifier, songId, slots, notifyChange],
  );

  // Hard gate: feature flag OR no manage permission → render nothing
  if (!flagOn || !canManage) return null;

  // B1: 페이지/줌/회전/맞춤모드 변경 announce. 모든 return 블록의 첫 자식으로 끼워
  // pending/compact/regular 어느 모드에서도 폴백 일관.
  const announcer = (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {announce}
    </span>
  );

  // ── pending 모드 (신규 곡 생성) ──────────────────────────────────────────
  // server endpoint 호출 없이 file 만 부모에게 전달. preview 는 blob URL 로 표시.
  if (mode === 'pending') {
    const showPendingViewer = pendingFile && pendingPreviewUrl && pendingType;
    return (
      <section className="border rounded-md overflow-hidden" ref={containerRef}>
        {announcer}
        <header className="px-3 py-2 bg-muted/50 border-b text-sm font-medium">
          악보 (매니저 전용)
        </header>
        {!showPendingViewer ? (
          <div className="p-3">
            <PendingSheetMusicSelector
              error={pendingError}
              onSelect={(file) => {
                if (!file) {
                  setPendingError(null);
                  onPendingFileChange?.(null);
                  return;
                }
                if (file.size > MAX_SIZE) {
                  setPendingError('30MB 이하 파일만 업로드 가능합니다.');
                  return;
                }
                const t = detectSheetMusicType(file.type, file.name);
                if (!t) {
                  setPendingError(
                    '지원하지 않는 형식입니다 (PDF, JPG, PNG, WebP, MusicXML만 가능)',
                  );
                  return;
                }
                setPendingError(null);
                onPendingFileChange?.(file);
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              노래 저장 시 함께 업로드됩니다.
            </p>
          </div>
        ) : (
          <>
            <SheetMusicToolbar
              type={pendingType}
              page={state.page}
              totalPages={totalPages}
              isFullscreen={isFullscreen}
              onPrev={onPrev}
              onNext={onNext}
              onZoomIn={onZoomIn}
              onZoomOut={onZoomOut}
              onFitWidth={onFitWidth}
              onFitPage={onFitPage}
              onToggleFullscreen={onToggleFullscreen}
              onRotate={onRotate}
              onDownload={onDownload}
              fitMode={state.fitMode}
              zoom={state.zoom}
              compact={compact}
            />
            <div className="p-2">
              <SheetMusicViewer
                url={pendingPreviewUrl}
                type={pendingType}
                zoom={state.zoom}
                page={state.page}
                rotation={state.rotation}
                onZoomChange={onZoomChange}
                onPagePrev={onPrev}
                onPageNext={onNext}
                canPagePrev={state.page > 1 || currentIndex > 0}
                canPageNext={
                  (!!totalPages && state.page < totalPages) ||
                  currentIndex < slots.length - 1
                }
                onTotalPages={setTotalPages}
              />
            </div>
            <footer className="px-3 py-2 bg-muted/50 border-t flex justify-between items-center gap-2">
              <span className="text-xs text-muted-foreground truncate">
                선택됨: {pendingFile.name} (저장 시 업로드)
              </span>
              <button
                type="button"
                className="text-xs text-destructive"
                onClick={() => {
                  setPendingError(null);
                  onPendingFileChange?.(null);
                }}
              >
                선택 취소
              </button>
            </footer>
          </>
        )}
      </section>
    );
  }

  // ── immediate 모드 (수정 흐름) ──────────────────────────────────────────
  if (readOnly && (!url || !type)) {
    return null;
  }

  // 본문 (uploader 또는 viewer + footer). Collapsible 래퍼 안/밖 양쪽에서 동일하게 사용.
  const body = (
    <>
      {!url || !type ? (
            <div className="p-3">
              <SheetMusicUploader
                channelIdentifier={channelIdentifier}
                songId={songId}
                onSlotAdded={handleSlotAppended}
              />
            </div>
          ) : isAddMode && !readOnly ? (
            // Phase 2: 추가 모드 — viewer 자리에 uploader 가 들어와 새 슬롯을 받는다.
            // 추가 성공 시 자동으로 viewer 로 복귀 (currentIndex = new slot 위치).
            <div className="p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                새 악보 파일을 선택하면 곡 끝 슬롯으로 추가됩니다 (현재 슬롯
                {slots.length}/10).
              </p>
              <SheetMusicUploader
                channelIdentifier={channelIdentifier}
                songId={songId}
                onSlotAdded={(slot) => {
                  handleSlotAppended(slot);
                  setIsAddMode(false);
                }}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setIsAddMode(false)}
                >
                  추가 취소
                </button>
              </div>
            </div>
          ) : (
            <>
              <SheetMusicToolbar
                type={type}
                page={state.page}
                totalPages={totalPages}
                isFullscreen={isFullscreen}
                onPrev={onPrev}
                onNext={onNext}
                onZoomIn={onZoomIn}
                onZoomOut={onZoomOut}
                onFitWidth={onFitWidth}
                onFitPage={onFitPage}
                onToggleFullscreen={onToggleFullscreen}
                onRotate={onRotate}
                onDownload={onDownload}
                compact={compact}
              />
              <div
                className="p-2"
                onDragOver={onViewerDragOver}
                onDrop={onViewerDrop}
              >
                <SectionErrorBoundary section="악보 뷰어">
                  <SheetMusicViewer
                    url={url}
                    type={type}
                    zoom={state.zoom}
                    page={state.page}
                    rotation={state.rotation}
                    onZoomChange={onZoomChange}
                    onPagePrev={onPrev}
                    onPageNext={onNext}
                    canPagePrev={state.page > 1}
                    canPageNext={!!totalPages && state.page < totalPages}
                    onTotalPages={setTotalPages}
                  />
                </SectionErrorBoundary>
              </div>
              {/* Phase 2: 다중 슬롯 (>1) 일 때 썸네일 strip — compact (라이브 콘솔)
                  외부 (모달/편집 폼) 에서만 노출. compact 는 cognitive load 절감 위해
                  footer 의 슬롯 indicator + ‹/› 만 사용. */}
              {!compact && slots.length > 1 && (
                <SheetMusicThumbnailStrip
                  slots={slots}
                  currentIndex={currentIndex}
                  onSelect={setCurrentIndex}
                  onReorder={(orderedIds) => void handleReorder(orderedIds)}
                  onDeleteSlot={
                    !readOnly
                      ? async (slotId) => {
                          if (slotId === 0) return; // legacy placeholder
                          try {
                            await deleteSongsChannelIdentifierSongIdSheetMusicSlot(
                              channelIdentifier,
                              songId,
                              slotId,
                            );
                            setSlots((prev) => {
                              const next = prev.filter((s) => s.id !== slotId);
                              notifyChange(next);
                              setCurrentIndex((idx) =>
                                Math.min(idx, Math.max(0, next.length - 1)),
                              );
                              return next;
                            });
                          } catch (err) {
                            toast.error(
                              extractApiErrorMessage(
                                err,
                                '슬롯 삭제에 실패했습니다.',
                              ),
                            );
                          }
                        }
                      : undefined
                  }
                  readOnly={readOnly}
                />
              )}
              {!readOnly && (
                <>
                  <footer className="px-3 py-2 bg-muted/50 border-t flex justify-between items-center gap-2">
                    {/* Phase 2: 슬롯 indicator + 슬롯 사이 nav. 다중 슬롯 (>1) 일 때만 노출. */}
                    {slots.length > 1 ? (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <button
                          type="button"
                          className="px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30"
                          onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                          disabled={currentIndex === 0}
                          aria-label="이전 슬롯"
                        >
                          ‹
                        </button>
                        <span className="tabular-nums">
                          슬롯 {currentIndex + 1} / {slots.length}
                        </span>
                        <button
                          type="button"
                          className="px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30"
                          onClick={() =>
                            setCurrentIndex((i) =>
                              Math.min(slots.length - 1, i + 1),
                            )
                          }
                          disabled={currentIndex >= slots.length - 1}
                          aria-label="다음 슬롯"
                        >
                          ›
                        </button>
                      </div>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                        onClick={() => setIsAddMode(true)}
                        disabled={isDeleting || slots.length >= 10}
                        title={
                          slots.length >= 10
                            ? '곡당 최대 10개까지 등록 가능합니다.'
                            : undefined
                        }
                      >
                        악보 추가
                      </button>
                      <button
                        type="button"
                        className="text-xs text-destructive disabled:opacity-50"
                        onClick={() => setIsDeleteConfirmOpen(true)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? '삭제 중…' : '악보 삭제'}
                      </button>
                    </div>
                  </footer>
                  {/* I4(문제2): 삭제 confirm dialog. song 삭제와 일관되게 확인 단계 추가.
                      S3 파일도 함께 사라짐을 명시하여 사용자가 의식적으로 결정하도록. */}
                  <AlertDialog
                    open={isDeleteConfirmOpen}
                    onOpenChange={(open) => {
                      if (!isDeleting) setIsDeleteConfirmOpen(open);
                    }}
                  >
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>악보 삭제</AlertDialogTitle>
                        <AlertDialogDescription>
                          정말 악보를 삭제하시겠습니까? 저장된 악보 파일도 함께
                          삭제되며 되돌릴 수 없습니다.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>
                          취소
                        </AlertDialogCancel>
                        <AlertDialogAction
                          disabled={isDeleting}
                          onClick={(e) => {
                            // Radix 가 click 후 자동 close 시켜서 isDeleting 상태가 표시되지
                            // 않는 문제 방지. 직접 handleDelete 끝에서 close.
                            e.preventDefault();
                            void handleDelete();
                          }}
                          className="bg-destructive hover:bg-destructive/90 focus:ring-destructive"
                        >
                          {isDeleting ? '삭제 중…' : '삭제'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </>
          )}
    </>
  );

  // compact (라이브 콘솔 사이드 패널) — 헤더/Collapsible 토글 생략. 곡 자체가
  // ResizablePanel 의 sticky header 안에 들어 있어 별도 라벨/토글 cognitive
  // load 가 noise 이상의 가치를 주지 못함.
  if (compact) {
    return (
      <section className="border rounded-md overflow-hidden" ref={containerRef}>
        {announcer}
        {body}
      </section>
    );
  }

  return (
    <section className="border rounded-md overflow-hidden" ref={containerRef}>
      {announcer}
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 border-b hover:bg-muted motion-safe:transition-colors text-sm font-medium"
            aria-label={isOpen ? '악보 접기' : '악보 펼치기'}
          >
            <span>악보 (매니저 전용)</span>
            <ChevronDown
              className={cn(
                'size-3.5 text-muted-foreground motion-safe:transition-transform',
                isOpen && 'rotate-180',
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>{body}</CollapsibleContent>
      </Collapsible>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pending mode 전용 dropzone (server 호출 없이 file 만 부모에게 전달).
// SheetMusicUploader 와 UI 는 비슷하지만 progress/error 가 단순화됨.
// ────────────────────────────────────────────────────────────────────────────
interface PendingSheetMusicSelectorProps {
  error: string | null;
  onSelect: (file: File | null) => void;
}

function PendingSheetMusicSelector({
  error,
  onSelect,
}: PendingSheetMusicSelectorProps) {
  return (
    <SheetMusicDropzone
      // 신규 곡 생성 폼은 1번에 1개만 보관 (Phase 2 신규 곡 다중 업로드는
      // POST song 후 backend round-trip 필요해 별도 흐름. Phase 2 Step 4 검토).
      onFilesSelect={(files) => onSelect(files[0] ?? null)}
      ariaLabel="악보 파일 선택 (저장 시 업로드)"
    >
      <p className="text-sm text-muted-foreground">
        악보 파일을 드래그하거나 클릭하여 선택 (PDF / 이미지 / MusicXML, 30MB 이하)
      </p>
      {error && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </SheetMusicDropzone>
  );
}
