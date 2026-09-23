import { Button } from "@/meloming/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Label } from "@/meloming/shared/components/ui/label";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/meloming/shared/components/ui/tooltip";
import { Info, Lock, ChevronRight } from "lucide-react";
import type {
  Manager,
  ManagerPermissionKey,
} from "@/meloming/domains/channel/types/manager";
import {
  MANAGER_PERMISSION_DEFINITIONS,
  type ManagerPermissionState,
} from "./permission-config";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import Link from "next/link";

interface EditManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manager: Manager | null;
  permissionState: ManagerPermissionState;
  onPermissionChange: (key: ManagerPermissionKey, value: boolean) => void;
  onSubmit: () => Promise<void>;
}

export function EditManagerDialog({
  open,
  onOpenChange,
  manager,
  permissionState,
  onPermissionChange,
  onSubmit,
}: EditManagerDialogProps) {
  const { isProSubscriber } = useAuth();
  const hasPermissionSelection = Object.values(permissionState).some(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="paperlogy">권한 수정</DialogTitle>
        </DialogHeader>
        {manager && (
          <div className="space-y-4">
            <div>
              <div className="font-medium">
                {manager.nickname || manager.user?.nickname}
              </div>
              {manager.user?.email && (
                <div className="text-sm text-muted-foreground">
                  {manager.user.email}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {MANAGER_PERMISSION_DEFINITIONS.map(
                ({ key, label, description }) => {
                  const inputId = `edit-${key}`;
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
                            className={
                              isDisabled ? "text-muted-foreground" : ""
                            }
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
                            className="h-auto p-0 text-xs text-indigo-500 hover:text-indigo-600 whitespace-nowrap"
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
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!hasPermissionSelection}
          >
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
