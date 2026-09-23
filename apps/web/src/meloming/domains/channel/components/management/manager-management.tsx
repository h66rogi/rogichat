import { useMemo, useState } from "react";
import { useParams } from "next/dist/client/components/navigation";
import { UserCog2, Plus, Lock } from "lucide-react";
import { ManagementHeader } from "./management-header";
import { Card, CardContent } from "@/meloming/shared/components/ui/card";
import { Button } from "@/meloming/shared/components/ui/button";
import { InlineError } from "@/meloming/shared/components/common/error-boundary";
import { AddManagerDialog } from "./manager/add-manager-dialog";
import { EditManagerDialog } from "./manager/edit-manager-dialog";
import { ManagerList } from "./manager/manager-list";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/meloming/shared/components/ui/alert-dialog";
import {
  useChannel,
  useChannelPermission,
} from "@/meloming/domains/channel/hooks/use-channel";
import {
  useManagersManagement,
  useManagerSearchUsers,
} from "@/meloming/domains/channel/hooks/use-managers";
import type {
  Manager,
  ManagerPermissionKey,
} from "@/meloming/domains/channel/types/manager";
import {
  MANAGER_PERMISSION_DEFINITIONS,
  type ManagerPermissionState,
} from "./manager/permission-config";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import Link from "next/link";
import { AnimatedGradientButton } from "@/meloming/shared/components/ui/animated-gradient-button";

const createEmptyPermissionState = (): ManagerPermissionState =>
  MANAGER_PERMISSION_DEFINITIONS.reduce((acc, def) => {
    acc[def.key] = false;
    return acc;
  }, {} as ManagerPermissionState);

const hasAnyPermission = (state: ManagerPermissionState) =>
  Object.values(state).some(Boolean);

export function ManagerManagement() {
  const { user } = useParams();
  const userParam = Array.isArray(user) ? user[0] : user;
  const username = userParam || "";
  const { data: publicUser } = useChannel(username);
  const channelId = publicUser?.id ?? 0;

  const { data: userPermission } = useChannelPermission(username);
  const { isProSubscriber } = useAuth();
  const toErrorDescription = (error: unknown) =>
    extractApiErrorMessage(error, "잠시 후 다시 시도해주세요.");

  const {
    listQuery,
    createManager,
    updateManager,
    deleteManager,
    toggleActive,
  } = useManagersManagement(channelId, { enabled: channelId > 0 });

  // API 응답에서 매니저 목록과 메타데이터 추출
  const managersResponse = listQuery.data;
  const managers = useMemo(
    () => managersResponse?.managers ?? [],
    [managersResponse]
  );

  // Manager limits (API 응답의 메타데이터 활용, 없으면 fallback)
  const maxManagers =
    managersResponse?.maxActiveManagers ?? (isProSubscriber ? 10 : 1);
  const activeManagerCount =
    managersResponse?.activeManagerCount ??
    managers.filter((m) => m.isActive).length;
  const currentManagerCount = managers.length;
  const canAddManager = currentManagerCount < maxManagers;

  // Add dialog state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [searchNickname, setSearchNickname] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [addPermissions, setAddPermissions] = useState<ManagerPermissionState>(
    () => createEmptyPermissionState()
  );
  const handleAddPermissionChange = (
    key: ManagerPermissionKey,
    value: boolean
  ) => {
    setAddPermissions((prev) => ({ ...prev, [key]: value }));
  };

  const canSearch = useMemo(
    () => channelId > 0 && searchNickname.trim().length >= 1,
    [channelId, searchNickname]
  );
  const { data: candidates, isFetching: isSearching } = useManagerSearchUsers(
    channelId,
    searchNickname,
    { enabled: canSearch }
  );

  const resetAddState = () => {
    setSearchNickname("");
    setSelectedUserId(null);
    setAddPermissions(createEmptyPermissionState());
  };

  const handleOpenAdd = () => {
    if (!canAddManager) {
      if (!isProSubscriber) {
        toast.error("매니저 추가 제한", {
          description:
            "일반 사용자는 매니저를 1명까지만 추가할 수 있습니다. Pro 구독으로 업그레이드하세요.",
          action: {
            label: "구독하기",
            onClick: () => (window.location.href = "/subscription"),
          },
        });
      } else {
        toast.error("매니저 추가 제한", {
          description: `Pro 사용자는 매니저를 최대 ${maxManagers}명까지 추가할 수 있습니다.`,
        });
      }
      return;
    }
    resetAddState();
    setIsAddOpen(true);
  };
  const handleCloseAdd = () => {
    setIsAddOpen(false);
    resetAddState();
  };

  const onSubmitAdd = async () => {
    if (!channelId || !selectedUserId) return;
    try {
      if (!hasAnyPermission(addPermissions)) {
        toast.error("권한 선택 필요", {
          description: "최소 1개의 권한을 선택해주세요.",
        });
        return;
      }
      await createManager.mutateAsync({
        userId: selectedUserId,
        ...addPermissions,
      });
      handleCloseAdd();
      await listQuery.refetch();
    } catch (error) {
      const description = toErrorDescription(error);
      toast.error("매니저 추가 실패", { description });
    }
  };

  // Edit state
  const [editingManager, setEditingManager] = useState<Manager | null>(null);
  const [editPermissions, setEditPermissions] =
    useState<ManagerPermissionState>(() => createEmptyPermissionState());
  const handleEditPermissionChange = (
    key: ManagerPermissionKey,
    value: boolean
  ) => {
    setEditPermissions((prev) => ({ ...prev, [key]: value }));
  };

  const handleOpenEdit = (m: Manager) => {
    setEditingManager(m);
    setEditPermissions({
      canManageContent: m.canManageContent ?? false,
      canManageSettings: m.canManageSettings ?? false,
      canManageProfile: m.canManageProfile ?? false,
      canManageGuestbook: m.canManageGuestbook ?? false,
      canManageCustomization: m.canManageCustomization ?? false,
      canManageEmoticons: m.canManageEmoticons ?? false,
    });
  };
  const handleCloseEdit = () => {
    setEditingManager(null);
    setEditPermissions(createEmptyPermissionState());
  };
  const onSubmitEdit = async () => {
    if (!channelId || !editingManager) return;
    try {
      if (!hasAnyPermission(editPermissions)) {
        toast.error("권한 선택 필요", {
          description: "최소 1개의 권한을 선택해주세요.",
        });
        return;
      }
      await updateManager.mutateAsync({
        managerId: editingManager.id,
        body: {
          ...editPermissions,
        },
      });
      handleCloseEdit();
      await listQuery.refetch();
    } catch (error) {
      const description = toErrorDescription(error);
      toast.error("권한 수정 실패", { description });
    }
  };

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Manager | null>(null);
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteManager.mutateAsync({ managerId: deleteTarget.id });
    setDeleteTarget(null);
    await listQuery.refetch();
  };

  // Toggle active state
  const [isToggling, setIsToggling] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<{
    manager: Manager;
    newActive: boolean;
  } | null>(null);

  // 현재 활성화된 매니저 찾기
  const activeManager = useMemo(
    () => managers.find((m) => m.isActive),
    [managers]
  );

  const handleToggleActive = async (manager: Manager, newActive: boolean) => {
    // 비활성화하는 경우 바로 처리
    if (!newActive) {
      await performToggle(manager, false);
      return;
    }

    // 활성화하려는 경우
    // Pro 구독자는 여러 매니저 활성화 가능
    if (isProSubscriber) {
      await performToggle(manager, true);
      return;
    }

    // 비구독자가 활성화하려는 경우
    // 이미 활성화된 매니저가 있고, 그게 자신이 아닌 경우 확인 모달 표시
    if (activeManager && activeManager.id !== manager.id) {
      setToggleTarget({ manager, newActive: true });
    } else {
      await performToggle(manager, true);
    }
  };

  const performToggle = async (manager: Manager, newActive: boolean) => {
    setIsToggling(true);
    try {
      await toggleActive.mutateAsync({
        managerId: manager.id,
        isActive: newActive,
      });
      await listQuery.refetch();
      toast.success(
        newActive
          ? "매니저가 활성화되었습니다."
          : "매니저가 비활성화되었습니다."
      );
    } catch (error) {
      const description = toErrorDescription(error);
      toast.error("상태 변경 실패", { description });
    } finally {
      setIsToggling(false);
    }
  };

  const confirmToggleSwap = async () => {
    if (!toggleTarget || !activeManager) return;
    setIsToggling(true);
    try {
      // 백엔드에서 자동으로 기존 활성 매니저를 비활성화하고 새 매니저를 활성화
      const result = await toggleActive.mutateAsync({
        managerId: toggleTarget.manager.id,
        isActive: true,
      });
      await listQuery.refetch();

      // 비활성화된 매니저가 있으면 표시
      if (result.deactivatedManagerId) {
        toast.success("매니저가 변경되었습니다.", {
          description: `${
            activeManager.nickname || activeManager.user?.nickname
          } → ${
            toggleTarget.manager.nickname || toggleTarget.manager.user?.nickname
          }`,
        });
      } else {
        toast.success("매니저가 활성화되었습니다.");
      }
    } catch (error) {
      const description = toErrorDescription(error);
      toast.error("상태 변경 실패", { description });
    } finally {
      setIsToggling(false);
      setToggleTarget(null);
    }
  };

  if (userPermission && !userPermission.isOwner) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="채널 매니저 설정"
          description="채널 매니저를 추가/수정/삭제할 수 있습니다."
          icon={UserCog2}
        />

        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed text-muted-foreground text-center">
          접근 권한이 없습니다.
          <br />
          (채널 소유자만 매니저 권한을 부여할 수 있습니다)
        </div>
      </div>
    );
  }

  if (listQuery.error) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="채널 매니저 설정"
          description="채널 매니저를 설정할 수 있습니다."
          icon={UserCog2}
        />
        <InlineError
          message="매니저 목록을 불러오는데 실패했습니다."
          onRetry={() => listQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="채널 매니저 설정"
        description="채널 매니저를 추가/수정/삭제할 수 있습니다."
        icon={UserCog2}
      >
        {managers.length > 0 && (
          <div className="flex items-center gap-3">
            {!isProSubscriber && (
              <div className="flex items-center gap-2 mr-2">
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  일반 유저는 매니저를 1명만 지정할 수 있습니다.
                </span>
              </div>
            )}
            <div className="text-sm text-muted-foreground hidden sm:flex sm:items-center sm:gap-3">
              <span>
                총{" "}
                <span className="font-medium text-foreground">
                  {currentManagerCount}
                </span>
                명
              </span>
              <span className="text-border">|</span>
              <span>
                활성{" "}
                <span
                  className={
                    activeManagerCount >= maxManagers
                      ? "text-destructive font-medium"
                      : "font-medium text-primary"
                  }
                >
                  {activeManagerCount}
                </span>
                <span className="mx-0.5">/</span>
                <span>{maxManagers}명</span>
              </span>
            </div>

            {/* Pro 구독자가 아니고 제한에 도달한 경우, 업그레이드 유도 버튼 노출 */}
            {!canAddManager && !isProSubscriber ? (
              <AnimatedGradientButton asChild>
                <Link href="/subscription">
                  <Lock className="w-4 h-4 mr-2" />
                  PRO 구독하고 매니저 10명까지 지정하기
                </Link>
              </AnimatedGradientButton>
            ) : (
              <Button
                onClick={handleOpenAdd}
                disabled={!canAddManager}
                variant={
                  !canAddManager && !isProSubscriber ? "secondary" : "default"
                }
              >
                {!canAddManager && !isProSubscriber ? (
                  <Lock className="w-4 h-4 mr-2" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                매니저 추가
              </Button>
            )}
          </div>
        )}
      </ManagementHeader>

      {listQuery.isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded bg-muted animate-pulse" />
          ))}
        </div>
      ) : managers && managers.length > 0 ? (
        <ManagerList
          managers={managers}
          onEdit={handleOpenEdit}
          onDelete={(m) => setDeleteTarget(m)}
          onToggleActive={handleToggleActive}
          isToggling={isToggling}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <UserCog2 className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2 paperlogy">
              매니저가 없습니다
            </h3>
            <p className="text-muted-foreground text-center mb-4">
              첫 번째 매니저를 추가해보세요.
            </p>
            <Button
              onClick={handleOpenAdd}
              disabled={!canAddManager}
              variant={
                !canAddManager && !isProSubscriber ? "secondary" : "default"
              }
            >
              {!canAddManager && !isProSubscriber ? (
                <Lock className="w-4 h-4 mr-2" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              매니저 추가
            </Button>
          </CardContent>
        </Card>
      )}
      <AddManagerDialog
        open={isAddOpen}
        onOpenChange={(open) => (open ? handleOpenAdd() : handleCloseAdd())}
        channelId={channelId}
        searchNickname={searchNickname}
        setSearchNickname={setSearchNickname}
        candidates={candidates}
        isSearching={isSearching}
        selectedUserId={selectedUserId}
        setSelectedUserId={setSelectedUserId}
        permissionState={addPermissions}
        onPermissionChange={handleAddPermissionChange}
        onSubmit={onSubmitAdd}
      />

      <EditManagerDialog
        open={!!editingManager}
        onOpenChange={() => handleCloseEdit()}
        manager={editingManager}
        permissionState={editPermissions}
        onPermissionChange={handleEditPermissionChange}
        onSubmit={onSubmitEdit}
      />

      {/* Delete confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="paperlogy">
              매니저 삭제
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>
                {deleteTarget?.nickname || deleteTarget?.user?.nickname}
              </strong>{" "}
              매니저 권한을 회수하시겠습니까?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Toggle swap confirm (비구독자 전용) */}
      <AlertDialog
        open={!!toggleTarget}
        onOpenChange={() => setToggleTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="paperlogy">
              활성 매니저 변경
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  일반 사용자는 한 번에 <strong>1명의 매니저만</strong> 활성화할
                  수 있습니다.
                </p>
                <div className="bg-muted p-3 rounded-lg text-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-destructive font-medium">
                      비활성화:
                    </span>
                    <span>
                      {activeManager?.nickname || activeManager?.user?.nickname}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-primary font-medium">활성화:</span>
                    <span>
                      {toggleTarget?.manager.nickname ||
                        toggleTarget?.manager.user?.nickname}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Pro 구독 시 최대 10명의 매니저를 동시에 활성화할 수 있습니다.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isToggling}>취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmToggleSwap}
              disabled={isToggling}
            >
              {isToggling ? "변경 중..." : "매니저 변경"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
