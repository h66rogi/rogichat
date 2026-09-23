import { Button } from "@/meloming/shared/components/ui/button";
import { Switch } from "@/meloming/shared/components/ui/switch";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { Edit, Trash2 } from "lucide-react";
import type { Manager } from "@/meloming/domains/channel/types/manager";
import { MANAGER_PERMISSION_DEFINITIONS } from "./permission-config";
import { cn } from "@/meloming/shared/lib/utils";

interface ManagerListProps {
  managers: Manager[];
  onEdit: (manager: Manager) => void;
  onDelete: (manager: Manager) => void;
  onToggleActive: (manager: Manager, isActive: boolean) => void;
  isToggling?: boolean;
}

export function ManagerList({
  managers,
  onEdit,
  onDelete,
  onToggleActive,
  isToggling,
}: ManagerListProps) {
  // 생성일 기준 정렬 (가장 먼저 생성된 매니저가 먼저)
  const sortedManagers = [...managers].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return (
    <div className="grid gap-3">
      {sortedManagers.map((m) => {
        const enabledPermissions = MANAGER_PERMISSION_DEFINITIONS.filter(
          ({ key }) => m[key]
        ).map(({ label }) => label);

        return (
          <div
            key={m.id}
            className={cn(
              "rounded-lg shadow-sm border overflow-hidden h-auto min-h-16 py-3 transition-all",
              m.isActive
                ? "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                : "bg-gray-50 dark:bg-gray-900/50 border-gray-200/50 dark:border-gray-700/50 opacity-60"
            )}
          >
            <div className="flex items-center justify-between h-full px-4">
              <div className="flex items-center gap-3 min-w-0">
                {/* 활성화 토글 */}
                <Switch
                  checked={m.isActive}
                  onCheckedChange={(checked) => onToggleActive(m, checked)}
                  disabled={isToggling}
                  className="shrink-0"
                />

                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-2">
                    {m.nickname || m.user?.nickname}
                    {!m.isActive && (
                      <Badge
                        variant="secondary"
                        className="text-xs shrink-0 bg-gray-200 dark:bg-gray-700"
                      >
                        비활성
                      </Badge>
                    )}
                    {m.user?.email && (
                      <span className="ml-1 text-muted-foreground text-sm truncate hidden sm:inline">
                        {m.user.email}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {enabledPermissions.length === 0
                      ? "부여된 권한이 없습니다."
                      : enabledPermissions.join(" · ")}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEdit(m)}
                  disabled={!m.isActive}
                >
                  <Edit className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">권한 수정</span>
                </Button>
                <Button
                  size="sm"
                  variant="destructive-outline"
                  onClick={() => onDelete(m)}
                >
                  <Trash2 className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">삭제</span>
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
