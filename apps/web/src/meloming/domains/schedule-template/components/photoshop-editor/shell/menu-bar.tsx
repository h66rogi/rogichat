"use client";

import Link from "next/link";
import { ArrowLeft, Check, Loader2, RotateCcw } from "lucide-react";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/meloming/shared/components/ui/menubar";
import { Button } from "@/meloming/shared/components/ui/button";
import { Input } from "@/meloming/shared/components/ui/input";
import { Switch } from "@/meloming/shared/components/ui/switch";
import { useEditorContext } from "../state/editor-context";

interface MenuBarProps {
  // 호버 dropdown 처리는 Menubar 가 담당.
}

/**
 * Photoshop 상단 메뉴바 — File / Edit / Layer / Select / View / Window.
 *
 * Photoshop 의 메뉴 구조를 따르되, 우리 데이터 모델에 의미 있는 항목만 노출.
 * 내부 컨트롤(이름 입력, 기본 토글, 저장 버튼) 은 메뉴 우측에 통합 — 사용자가
 * "현재 편집 중인 템플릿 메타" 를 같은 영역에서 확인/수정.
 */
export function MenuBar(_props: MenuBarProps) {
  const ctx = useEditorContext();

  return (
    <div
      data-photoshop-menubar
      className="flex items-center justify-between px-2 border-b shrink-0"
      style={{
        height: "var(--ps-menu-bar-height)",
        background: "var(--ps-bg)",
        borderColor: "var(--ps-divider)",
      }}
    >
      <div className="flex items-center gap-1">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] hover:bg-[var(--ps-bg-hover)]"
        >
          <Link href={ctx.listHref}>
            <ArrowLeft className="size-3" />
            목록
          </Link>
        </Button>
        <span
          className="mx-1"
          style={{
            width: 1,
            height: 14,
            background: "var(--ps-border)",
          }}
        />

        <Menubar
          className="border-0 bg-transparent p-0 h-6"
          data-photoshop-menubar-root
        >
          <FileMenu />
          <EditMenu />
          <LayerMenu />
          <SelectMenu />
          <ViewMenu />
        </Menubar>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={ctx.name}
          onChange={(e) => ctx.setName(e.target.value)}
          placeholder="템플릿 이름"
          maxLength={100}
          disabled={ctx.saving}
          className="h-6 w-48 text-[11px] bg-[var(--ps-bg-input)] border-[var(--ps-border)]"
        />
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
          <Switch
            checked={ctx.isDefault}
            onCheckedChange={ctx.setIsDefault}
            disabled={ctx.saving}
            className="scale-75"
          />
          기본
        </label>
        {ctx.dirty && (
          <span className="text-[10px] text-[var(--ps-text-muted)]">●</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={ctx.revert}
          disabled={!ctx.dirty || ctx.saving}
          className="h-6 px-2 text-[11px]"
        >
          <RotateCcw className="size-3" />
          되돌리기
        </Button>
        <Button
          size="sm"
          onClick={ctx.save}
          disabled={!ctx.dirty || ctx.saving}
          className="h-6 px-3 text-[11px]"
        >
          {ctx.saving ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              저장 중
            </>
          ) : (
            <>
              <Check className="size-3" />
              저장
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function FileMenu() {
  const ctx = useEditorContext();
  return (
    <MenubarMenu>
      <MenubarTrigger className="h-6 px-2 text-[11px] data-[state=open]:bg-[var(--ps-bg-hover)]">
        파일
      </MenubarTrigger>
      <MenubarContent
        className="bg-[var(--ps-bg-elevated)] border-[var(--ps-border)] text-[var(--ps-text)] min-w-[200px]"
      >
        <MenubarItem onSelect={() => ctx.save()} disabled={!ctx.dirty || ctx.saving}>
          저장
          <MenubarShortcut>⌘S</MenubarShortcut>
        </MenubarItem>
        <MenubarItem onSelect={() => ctx.revert()} disabled={!ctx.dirty || ctx.saving}>
          되돌리기
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  );
}

function EditMenu() {
  const ctx = useEditorContext();
  return (
    <MenubarMenu>
      <MenubarTrigger className="h-6 px-2 text-[11px] data-[state=open]:bg-[var(--ps-bg-hover)]">
        편집
      </MenubarTrigger>
      <MenubarContent
        className="bg-[var(--ps-bg-elevated)] border-[var(--ps-border)] text-[var(--ps-text)] min-w-[200px]"
      >
        <MenubarItem onSelect={() => ctx.undo()} disabled={!ctx.canUndo}>
          실행 취소
          <MenubarShortcut>⌘Z</MenubarShortcut>
        </MenubarItem>
        <MenubarItem onSelect={() => ctx.redo()} disabled={!ctx.canRedo}>
          다시 실행
          <MenubarShortcut>⌘⇧Z</MenubarShortcut>
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem
          onSelect={() => ctx.duplicateSelected()}
          disabled={ctx.selectedSlotIds.length === 0}
        >
          복제
          <MenubarShortcut>⌘D</MenubarShortcut>
        </MenubarItem>
        <MenubarItem
          onSelect={() => ctx.deleteSelected()}
          disabled={ctx.selectedSlotIds.length === 0}
        >
          삭제
          <MenubarShortcut>Del</MenubarShortcut>
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  );
}

function LayerMenu() {
  const ctx = useEditorContext();
  const single = ctx.selectedSlotIds[0];
  const hasSingle = ctx.selectedSlotIds.length === 1;
  return (
    <MenubarMenu>
      <MenubarTrigger className="h-6 px-2 text-[11px] data-[state=open]:bg-[var(--ps-bg-hover)]">
        레이어
      </MenubarTrigger>
      <MenubarContent
        className="bg-[var(--ps-bg-elevated)] border-[var(--ps-border)] text-[var(--ps-text)] min-w-[220px]"
      >
        <MenubarItem onSelect={() => ctx.addText()}>새 텍스트 레이어</MenubarItem>
        <MenubarItem onSelect={() => ctx.addImage()}>새 이미지 레이어</MenubarItem>
        <MenubarItem onSelect={() => ctx.addRectangle()}>새 사각형</MenubarItem>
        <MenubarSeparator />
        <MenubarItem onSelect={() => ctx.duplicateSelected()} disabled={!hasSingle}>
          레이어 복제
        </MenubarItem>
        <MenubarItem onSelect={() => ctx.deleteSelected()} disabled={ctx.selectedSlotIds.length === 0}>
          레이어 삭제
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem
          onSelect={() => single && ctx.bringToFront(single)}
          disabled={!hasSingle}
        >
          맨 앞으로
        </MenubarItem>
        <MenubarItem
          onSelect={() => single && ctx.bringForward(single)}
          disabled={!hasSingle}
        >
          앞으로
          <MenubarShortcut>⌘]</MenubarShortcut>
        </MenubarItem>
        <MenubarItem
          onSelect={() => single && ctx.sendBackward(single)}
          disabled={!hasSingle}
        >
          뒤로
          <MenubarShortcut>⌘[</MenubarShortcut>
        </MenubarItem>
        <MenubarItem
          onSelect={() => single && ctx.sendToBack(single)}
          disabled={!hasSingle}
        >
          맨 뒤로
        </MenubarItem>
        <MenubarSeparator />
        <MenubarItem
          onSelect={() => ctx.groupSelected()}
          disabled={ctx.selectedSlotIds.length < 2}
        >
          그룹 만들기
          <MenubarShortcut>⌘G</MenubarShortcut>
        </MenubarItem>
        <MenubarItem
          onSelect={() => ctx.ungroupSelected()}
          disabled={ctx.selectedSlotIds.length === 0}
        >
          그룹 해제
          <MenubarShortcut>⌘⇧G</MenubarShortcut>
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  );
}

function SelectMenu() {
  const ctx = useEditorContext();
  return (
    <MenubarMenu>
      <MenubarTrigger className="h-6 px-2 text-[11px] data-[state=open]:bg-[var(--ps-bg-hover)]">
        선택
      </MenubarTrigger>
      <MenubarContent
        className="bg-[var(--ps-bg-elevated)] border-[var(--ps-border)] text-[var(--ps-text)] min-w-[200px]"
      >
        <MenubarItem onSelect={() => ctx.selectAll()}>
          전체 선택
          <MenubarShortcut>⌘A</MenubarShortcut>
        </MenubarItem>
        <MenubarItem onSelect={() => ctx.deselectAll()} disabled={ctx.selectedSlotIds.length === 0}>
          선택 해제
          <MenubarShortcut>⌘D</MenubarShortcut>
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  );
}

function ViewMenu() {
  const ctx = useEditorContext();
  return (
    <MenubarMenu>
      <MenubarTrigger className="h-6 px-2 text-[11px] data-[state=open]:bg-[var(--ps-bg-hover)]">
        보기
      </MenubarTrigger>
      <MenubarContent
        className="bg-[var(--ps-bg-elevated)] border-[var(--ps-border)] text-[var(--ps-text)] min-w-[200px]"
      >
        <MenubarItem
          onSelect={() => ctx.setGridSnapEnabled(!ctx.gridSnapEnabled)}
        >
          {ctx.gridSnapEnabled ? "✓ " : "  "}그리드 스냅
        </MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  );
}
