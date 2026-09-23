import { useMemo } from "react";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/meloming/shared/components/ui/tooltip";
import { Info, Lock, ChevronRight } from "lucide-react";
import type {
  ManagerPermissionKey,
  ManagerSearchUser,
} from "@/meloming/domains/channel/types/manager";
import {
  MANAGER_PERMISSION_DEFINITIONS,
  type ManagerPermissionState,
} from "./permission-config";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import Link from "next/link";

interface AddManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: number;
  searchNickname: string;
  setSearchNickname: (value: string) => void;
  candidates: ManagerSearchUser[] | undefined;
  isSearching: boolean;
  selectedUserId: number | null;
  setSelectedUserId: (id: number | null) => void;
  permissionState: ManagerPermissionState;
  onPermissionChange: (key: ManagerPermissionKey, value: boolean) => void;
  onSubmit: () => Promise<void>;
}

export function AddManagerDialog({
  open,
  onOpenChange,
  channelId,
  searchNickname,
  setSearchNickname,
  candidates,
  isSearching,
  selectedUserId,
  setSelectedUserId,
  permissionState,
  onPermissionChange,
  onSubmit,
}: AddManagerDialogProps) {
  const { isProSubscriber } = useAuth();

  const canSearch = useMemo(
    () => channelId > 0 && searchNickname.trim().length >= 1,
    [channelId, searchNickname]
  );
  const hasPermissionSelection = useMemo(
    () => Object.values(permissionState).some(Boolean),
    [permissionState]
  );
  const canSubmit = Boolean(selectedUserId) && hasPermissionSelection;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="paperlogy">매니저 추가</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nickname">닉네임 검색</Label>
            <Input
              id="nickname"
              value={searchNickname}
              onChange={(e) => setSearchNickname(e.target.value)}
              placeholder="닉네임 일부를 입력하세요 (최소 1글자)"
            />
            <div className="text-xs text-muted-foreground">
              {isSearching
                ? "검색 중..."
                : canSearch
                ? `${candidates?.length ?? 0}명 발견`
                : "검색어를 입력하세요"}
            </div>
          </div>

          {canSearch && (candidates?.length ?? 0) > 0 && (
            <div className="max-h-56 overflow-auto rounded border p-2">
              {candidates?.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelectedUserId(u.id)}
                  className={`w-full text-left px-2 py-2 rounded hover:bg-accent ${
                    selectedUserId === u.id ? "bg-accent" : ""
                  }`}
                >
                  <div className="font-medium">{u.nickname}</div>
                  <div className="text-xs text-muted-foreground">
                    {u.email}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {MANAGER_PERMISSION_DEFINITIONS.map(
              ({ key, label, description }) => {
              const inputId = `add-${key}`;
                // Pro 구독자가 아니면서 'canManageCustomization' 권한인 경우 비활성화
                const isDisabled =
                  key === "canManageCustomization" && !isProSubscriber;

              return (
                  <div key={key} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                  <Switch
                    id={inputId}
                    checked={permissionState[key]}
                    onCheckedChange={(checked) =>
                      onPermissionChange(key, checked === true)
                    }
                        disabled={isDisabled}
                  />
                      <Label
                        htmlFor={inputId}
                        className="flex items-center gap-1"
                      >
                        <span
                          className={isDisabled ? "text-muted-foreground" : ""}
                        >
                    {label}
                        </span>
                        {isDisabled && (
                          <Lock className="w-3 h-3 text-muted-foreground" />
                        )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-4 h-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent sideOffset={4}>
                            {isDisabled ? (
                              <span>Pro 구독자 전용 권한입니다.</span>
                            ) : (
                              description
                            )}
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                    </div>
                    {isDisabled && (
                      <div className="pl-12">
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs text-indigo-500 hover:text-indigo-600"
                          asChild
                        >
                          <Link href="/subscription">
                            구독하고 사용하기{" "}
                            <ChevronRight className="w-3 h-3 ml-0.5" />
                          </Link>
                        </Button>
                      </div>
                    )}
                </div>
              );
              }
            )}
            <p className="text-xs text-muted-foreground">
              최소 한 개 이상의 권한을 선택해야 합니다.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button type="button" onClick={onSubmit} disabled={!canSubmit}>
            추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
