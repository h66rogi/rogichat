'use client';
import {
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/meloming/shared/lib/utils';

/**
 * 모든 악보 dropzone 진입점에서 공유하는 accept attribute.
 * SheetMusicUploader (immediate 업로드) 와 PendingSheetMusicSelector (신규 곡 생성)
 * 가 동일한 형식을 받아야 사용자 경험이 일관 — 한 곳에서 관리.
 */
export const SHEET_MUSIC_ACCEPT_ATTR =
  '.pdf,.jpg,.jpeg,.png,.webp,.musicxml,.xml,.mxl,application/pdf,image/jpeg,image/png,image/webp,application/xml,text/xml,application/zip';

export interface SheetMusicDropzoneProps {
  /**
   * 파일 선택/드롭 시 호출. 부모가 size/MIME validation 책임. multiple=true 일
   * 때 사용자가 여러 파일을 한 번에 선택/드롭하면 배열 길이 > 1.
   */
  onFilesSelect: (files: File[]) => void;
  /** dropzone 본문 (안내 텍스트 + progress/error 등 부모 결정). */
  children: ReactNode;
  /** 스크린리더용 dropzone 라벨 — uploader 와 selector 가 다른 의미. */
  ariaLabel: string;
  className?: string;
  /**
   * Phase 2 — multiple 파일 선택 가능. 입력 다중 가능 (input multiple 속성).
   * default false (단일).
   */
  multiple?: boolean;
}

/**
 * 악보 파일 dropzone — 드래그앤드롭 + 클릭 + 키보드(Enter/Space) 진입.
 * accept attribute 와 dropzone 시각 패턴을 한 곳에서 관리해 SheetMusicUploader 와
 * PendingSheetMusicSelector 의 UI/접근성 drift 를 차단.
 */
export function SheetMusicDropzone({
  onFilesSelect,
  children,
  ariaLabel,
  className,
  multiple = false,
}: SheetMusicDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // P3-A1: role=button 인 dropzone 은 children 텍스트가 자동으로 SR 에 읽히지
  // 않는다. 시각 안내와 별도로 sr-only 영역에 형식/크기 제약을 두고 aria-describedby
  // 로 연결 — VoiceOver/NVDA 사용자가 dropzone 에 진입할 때 aria-label("악보
  // 업로드") 과 함께 "지원 형식: PDF, JPG, PNG, WebP, MusicXML. 최대 30MB." 를
  // 같이 듣게 된다.
  const descriptionId = useId();

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(true);
  }
  function onDragLeave() {
    setDragOver(false);
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const list = e.dataTransfer.files;
    if (!list || list.length === 0) return;
    const files = multiple ? Array.from(list) : [list[0]!];
    onFilesSelect(files);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  return (
    <div
      className={cn(
        'border-2 border-dashed rounded-md p-6 text-center cursor-pointer motion-safe:transition-colors',
        dragOver ? 'border-primary bg-primary/10' : 'border-input',
        className,
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-describedby={descriptionId}
    >
      <input
        ref={inputRef}
        type="file"
        accept={SHEET_MUSIC_ACCEPT_ATTR}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const list = e.target.files;
          if (list && list.length > 0) {
            const files = multiple ? Array.from(list) : [list[0]!];
            onFilesSelect(files);
          }
          // 같은 파일을 다시 고를 수 있도록 input value 를 리셋. validation 실패 후
          // 같은 파일 재시도 / "선택 취소" 후 같은 파일 재선택 시 onChange 가 발화되지
          // 않는 문제 방지.
          e.currentTarget.value = '';
        }}
      />
      <span id={descriptionId} className="sr-only">
        지원 형식: PDF, JPG, PNG, WebP, MusicXML. 최대 30MB.
      </span>
      {children}
    </div>
  );
}
