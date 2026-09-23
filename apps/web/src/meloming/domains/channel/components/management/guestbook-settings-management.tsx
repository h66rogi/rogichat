"use client";

import { useParams } from "next/navigation";
import { BookOpen, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ManagementHeader } from "./management-header";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  SettingsInlineNote,
  SettingsPanel,
  SettingsRow,
} from "@/meloming/shared/components/common/settings-form";
import {
  useChannelGuestbookSettings,
  useUpdateChannelGuestbookSettings,
} from "@/meloming/domains/channel/hooks/use-channel";

export function GuestbookSettingsManagement() {
  const params = useParams();
  const identifier = (params?.user as string) || "";

  const { data, isLoading } = useChannelGuestbookSettings(identifier);
  const updateMutation = useUpdateChannelGuestbookSettings(identifier);

  const isGuestbookEnabled = data?.guestbookEnabled ?? true;

  const handleToggle = (checked: boolean) => {
    updateMutation.mutate(checked, {
      onSuccess: (result) => {
        toast.success(result.message);
      },
      onError: () => {
        toast.error("방명록 설정 변경에 실패했습니다.");
      },
    });
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <ManagementHeader
          title="방명록"
          description="채널 방명록 기능을 관리합니다."
          icon={BookOpen}
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <ManagementHeader
        title="방명록"
        description="채널 방명록 기능을 관리합니다."
        icon={BookOpen}
      />

      <div className="space-y-4">
        <SettingsPanel>
          <SettingsRow
            title="방명록 기능"
            description="채널 페이지에서 방명록 탭을 표시합니다."
            controlClassName="flex items-start sm:justify-end"
          >
            <Switch
              id="guestbook-toggle"
              checked={isGuestbookEnabled}
              onCheckedChange={handleToggle}
              disabled={updateMutation.isPending}
            />
          </SettingsRow>

          <SettingsInlineNote icon={Info} className="border-t">
            방명록을 비활성화하면 기존 방명록 내용은 유지되지만, 채널 페이지에서
            방명록 탭이 숨겨집니다.
          </SettingsInlineNote>
        </SettingsPanel>
      </div>
    </div>
  );
}
