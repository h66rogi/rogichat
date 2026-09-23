"use client";

import { ShieldCheck } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { IdentityMethodSelect } from "@/meloming/domains/user/components/identity-method-select";

interface IdentityVerificationWallProps {
  onClose?: () => void;
  onSuccess?: () => void;
}

/**
 * 본인인증이 필요한 기능에서 사용하는 범용 Wall 컴포넌트.
 * Dialog 내부에서 사용. 한국 휴대폰(PortOne) / 해외(Didit) 두 카드 분기.
 */
export function IdentityVerificationWall({
  onClose,
  onSuccess,
}: IdentityVerificationWallProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5" />
          본인인증 필요
        </DialogTitle>
        <DialogDescription>
          해당 기능을 이용하기 위해서는 본인인증이 필요합니다.
        </DialogDescription>
      </DialogHeader>

      <div className="py-6 space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          안전한 로기챗 서비스 운영을 위해, 본 기능은 본인인증을 완료한 유저만
          이용할 수 있습니다.
          <br />
          <span className="text-xs">
            (본인인증은 계정당 1회, 같은 명의로 최대 2개 계정까지 인증할 수
            있습니다)
          </span>
        </p>

        <IdentityMethodSelect onSuccess={onSuccess} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          닫기
        </Button>
      </DialogFooter>
    </>
  );
}
