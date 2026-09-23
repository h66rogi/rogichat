"use client";

import { Smartphone, Globe, Loader2 } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { cn } from "@/meloming/shared/lib/utils";
import {
  useIdentityVerification,
  useDiditVerification,
} from "@/meloming/domains/user/hooks";

interface IdentityMethodSelectProps {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * 본인인증 방식 2분기 선택.
 *  - 한국 휴대폰 (PortOne/KCP)
 *  - 해외 거주자/외국인 글로벌 KYC (Didit)
 *
 * 카드 패턴은 meloming-commission-front IdentityMethodSelect 와 동일.
 */
export function IdentityMethodSelect({
  onSuccess,
  onError,
}: IdentityMethodSelectProps) {
  const kr = useIdentityVerification({ onSuccess, onError });
  const didit = useDiditVerification({ onSuccess, onError });
  const busy = kr.isVerifying || didit.isVerifying;

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {/* 한국 휴대폰 */}
      <div
        className={cn(
          "flex flex-col text-left p-5 rounded-2xl border-2 transition-all",
          "hover:border-primary hover:shadow-md",
        )}
      >
        <Smartphone className="size-7 text-primary mb-3" />
        <h3 className="text-base font-bold mb-1">한국 휴대폰</h3>
        <p className="text-sm text-muted-foreground mb-4 flex-1">
          국내 통신사 가입자용. 본인 명의 휴대폰으로 즉시 인증합니다.
        </p>
        <Button
          type="button"
          className="w-full"
          disabled={busy}
          onClick={() => kr.verify()}
        >
          {kr.isVerifying ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              인증 진행 중...
            </>
          ) : (
            "휴대폰으로 인증"
          )}
        </Button>
      </div>

      {/* Overseas Resident (Didit) — 해외 사용자를 위해 영어 메인 + 한국어 보조 */}
      <div
        className={cn(
          "flex flex-col text-left p-5 rounded-2xl border-2 transition-all",
          "hover:border-primary hover:shadow-md",
        )}
      >
        <Globe className="size-7 text-primary mb-3" />
        <h3 className="text-base font-bold mb-1">
          Overseas Resident
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (해외 거주자)
          </span>
        </h3>
        <p className="text-sm text-muted-foreground mb-1 flex-1">
          For users without a Korean mobile number. Verify with your passport or
          foreign government ID.
          <br />
          <span className="text-xs">
            한국 휴대폰이 없는 해외 거주자·외국인용. 여권/외국 신분증으로 인증.
          </span>
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Note: Overseas-verified accounts cannot receive gifts (parcel
          delivery) or earn revenue. Sending gifts is allowed. (Support
          coming soon.)
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => didit.verify()}
        >
          {didit.isVerifying ? (
            <>
              <Loader2 className="size-4 mr-2 animate-spin" />
              Redirecting to Didit...
            </>
          ) : (
            "Verify with Didit"
          )}
        </Button>
      </div>
    </div>
  );
}
