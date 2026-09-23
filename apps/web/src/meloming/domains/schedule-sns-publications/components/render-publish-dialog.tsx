"use client";

import { useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { isAxiosError } from "axios";
import { toast } from "sonner";
import { Button } from "@/meloming/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/meloming/shared/components/ui/dialog";
import { Input } from "@/meloming/shared/components/ui/input";
import { Label } from "@/meloming/shared/components/ui/label";
import { Switch } from "@/meloming/shared/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/meloming/shared/components/ui/tabs";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { extractApiErrorMessage } from "@/meloming/shared/lib/api-error";
import { usePublishScheduleRender } from "@/meloming/domains/schedule-sns-publications/hooks";
import type {
  CreateScheduleSnsPublicationRequest,
  ScheduleSnsPublication,
} from "@/meloming/domains/schedule-sns-publications/types";
import type { SnsPlatform } from "@/meloming/domains/sns-credentials/types/sns-platform";
import {
  validateXTweet,
  X_TWEET_MAX_WEIGHTED_LENGTH,
} from "@/meloming/domains/schedule-sns-publications/utils/x-tweet-validation";

/**
 * X 트윗 가중 글자수 한도 (twitter-text 기준 280).
 *
 * 단순 `string.length` 가 아닌 weighted length (한글 2, URL 23 고정 등) 정책을
 * 사용한다. 자세한 규칙은 `utils/x-tweet-validation.ts` 참고.
 */
export const X_TWEET_MAX_LENGTH = X_TWEET_MAX_WEIGHTED_LENGTH;

/** 백엔드 publishBody 최대 길이 (DTO Length(1, 5000)). */
const PUBLISH_BODY_MAX_LENGTH = 5_000;

/** 네이버 카페 subject 최대 길이 (DTO Length(1, 200)). */
const NAVER_SUBJECT_MAX_LENGTH = 200;

/**
 * 백엔드 `BadRequestException({ code: 'ALREADY_POSTED_EXTERNALLY', ... })`
 * 응답 body 의 코드값. 실패한 publication 이 외부엔 이미 게시된 희귀 race
 * 상태에서 재게시 시도를 거부할 때 사용된다.
 *
 * 출처: `meloming-back/src/schedule-sns-publications/schedule-sns-publications.service.ts`
 *  → `resolveExistingPublication`.
 */
const ALREADY_POSTED_EXTERNALLY_CODE = "ALREADY_POSTED_EXTERNALLY";

/**
 * 백엔드 SNS 미연동 에러 코드. 현재 백엔드는 message 문자열에
 * `(SNS_NOT_CONNECTED)` 를 포함시키는 형태로 알려오므로 message-passthrough 로
 * 이미 동작하지만, 백엔드가 body.code 형태로 바뀌어도 안전하게 처리되도록
 * 코드 매칭도 함께 한다 (Codex F9 review#2 MINOR — forward compat).
 */
const SNS_NOT_CONNECTED_CODE = "SNS_NOT_CONNECTED";

interface RenderPublishDialogProps {
  /** 다이얼로그 표시 여부 (제어형). */
  open: boolean;
  /** 다이얼로그 닫기 핸들러. */
  onOpenChange: (open: boolean) => void;
  /** 대상 렌더 ID. */
  renderId: number;
  /** 사용자가 선택할 수 있는 플랫폼들 (연동 + 활성). 비어있으면 다이얼로그 자체를 띄우지 말 것. */
  availablePlatforms: SnsPlatform[];
  /** 게시 성공 시 콜백 — 호출 측은 폴링 reset 등 후처리 수행. */
  onPublished?: (data: ScheduleSnsPublication) => void;
}

interface NaverCafeMeta {
  cafeId: string;
  menuId: string;
  subject: string;
  openYn: boolean;
}

const PLATFORM_LABEL: Record<SnsPlatform, string> = {
  X: "X",
  NAVER_CAFE: "네이버 카페",
};

const PLATFORM_BODY_PLACEHOLDER: Record<SnsPlatform, string> = {
  X: "트윗에 게시할 내용을 입력하세요. (최대 280자)",
  NAVER_CAFE:
    "네이버 카페 게시글 본문을 입력하세요. HTML 태그를 사용할 수 있어요.",
};

/**
 * 렌더 결과를 SNS 에 게시하는 다이얼로그.
 *
 * - 플랫폼 탭은 `availablePlatforms` 에 포함된 것만 노출.
 * - X: 본문(weighted 280자 제한) 만 입력. twitter-text 기반 가중 글자수 사용.
 * - NAVER_CAFE: 본문 + cafeId / menuId / subject / openYn(switch).
 *
 * 에러 처리 (백엔드 실제 응답 기준):
 *  - 400 + body.code='ALREADY_POSTED_EXTERNALLY' → 외부 이미 게시된 희귀 race 안내
 *  - 400 (그 외) / 401 / 403 / 404 → 서버 메시지 (extractApiErrorMessage)
 *  - 500 → "잠시 후 다시 시도해 주세요."
 *  - 네트워크 (no response) → 일반 메시지 (호출 측 retry 가능).
 *
 * 참고: 백엔드는 202 ACCEPTED + 동일 row 재사용을 멱등 처리하므로 409 Conflict
 * 는 발생하지 않는다. 503 도 service 가 던지지 않는다 — 큐 enqueue 실패는 500
 * (`InternalServerErrorException`).
 */
export function RenderPublishDialog({
  open,
  onOpenChange,
  renderId,
  availablePlatforms,
  onPublished,
}: RenderPublishDialogProps) {
  const [activePlatform, setActivePlatform] = useState<SnsPlatform>(
    availablePlatforms[0] ?? "X",
  );
  const [publishBody, setPublishBody] = useState("");
  const [naverMeta, setNaverMeta] = useState<NaverCafeMeta>({
    cafeId: "",
    menuId: "",
    subject: "",
    openYn: true,
  });

  // 다이얼로그가 닫힐 때마다 입력 초기화 — useEffect 대신 onOpenChange 핸들러에서
  // 직접 reset 하여 react-hooks/set-state-in-effect 룰 회피.
  // (effect 안에서의 setState 는 cascade 렌더 문제를 일으킬 수 있어 lint 가 막는다.)
  const resetForm = () => {
    setPublishBody("");
    setNaverMeta({ cafeId: "", menuId: "", subject: "", openYn: true });
    setActivePlatform(availablePlatforms[0] ?? "X");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      resetForm();
    } else {
      // 열릴 때 첫 사용 가능 플랫폼으로 초기화 — 부모가 close→open 사이에 가용
      // 플랫폼을 바꿨을 가능성을 커버.
      setActivePlatform(availablePlatforms[0] ?? "X");
    }
    onOpenChange(next);
  };

  const publish = usePublishScheduleRender({
    onSuccess: (data) => {
      toast.success("게시 큐에 추가되었어요. 잠시 후 상태가 갱신됩니다.");
      onPublished?.(data);
      // 다이얼로그 닫고 + 입력 초기화. 부모가 onOpenChange 만 받으므로 직접 reset 후
      // 부모에 전달.
      resetForm();
      onOpenChange(false);
    },
    onError: (error) => {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      // 400 + ALREADY_POSTED_EXTERNALLY: 외부엔 이미 게시됐지만 DB 가 FAILED 로
      // 남은 희귀 race. 백엔드가 status=400 + body.code 로 식별값을 준다.
      // 400 + SNS_NOT_CONNECTED (forward-compat): 현재 백엔드는 message 에 코드
      // 문자열을 포함시키는 방식이라 default 분기로도 잘 노출되지만, body.code
      // 형태로 변경되어도 안전하게 동일 안내를 내보내도록 명시 매칭.
      if (status === 400) {
        const body = isAxiosError(error)
          ? (error.response?.data as { code?: unknown } | undefined)
          : undefined;
        if (body?.code === ALREADY_POSTED_EXTERNALLY_CODE) {
          toast.error(
            "외부 플랫폼에 이미 게시된 기록이 있어요. 관리자 확인이 필요합니다.",
          );
          return;
        }
        if (body?.code === SNS_NOT_CONNECTED_CODE) {
          toast.error(
            `${PLATFORM_LABEL[activePlatform]} 연동 후 다시 시도해 주세요.`,
          );
          return;
        }
      }
      if (status === 500) {
        // 큐 enqueue 실패 등 일시적 시스템 장애.
        toast.error("잠시 후 다시 시도해 주세요.");
        return;
      }
      if (
        isAxiosError(error) &&
        !error.response &&
        error.code !== "ERR_CANCELED"
      ) {
        // 네트워크 단계 실패 — 다이얼로그 유지하여 사용자가 재시도 가능.
        toast.error(
          "네트워크 오류로 게시 요청에 실패했어요. 다시 시도해 주세요.",
        );
        return;
      }
      // 400 (그 외)/401/403/404 — 서버 메시지가 사용자 친화적이라 그대로 노출.
      toast.error(
        extractApiErrorMessage(
          error,
          "게시 요청에 실패했어요. 잠시 후 다시 시도해 주세요.",
        ),
      );
    },
  });

  const trimmedBody = publishBody.trim();
  // X 가중 글자수 — twitter-text 기반. 카운터/버튼 활성화/유효성 검증의 단일 진실원.
  const xValidation = useMemo(
    () => validateXTweet(publishBody),
    [publishBody],
  );

  const validation = useMemo(() => {
    if (trimmedBody.length === 0) {
      return { ok: false, message: "본문을 입력해주세요." } as const;
    }
    if (trimmedBody.length > PUBLISH_BODY_MAX_LENGTH) {
      return {
        ok: false,
        message: `본문은 ${PUBLISH_BODY_MAX_LENGTH}자 이내여야 합니다.`,
      } as const;
    }
    if (activePlatform === "X" && !xValidation.valid) {
      return {
        ok: false,
        message: `X 게시는 가중 글자수 ${X_TWEET_MAX_LENGTH} 이내만 가능합니다. (현재 ${xValidation.weightedLength})`,
      } as const;
    }
    if (activePlatform === "NAVER_CAFE") {
      if (!naverMeta.cafeId.trim()) {
        return { ok: false, message: "네이버 카페 ID 를 입력해주세요." } as const;
      }
      if (!naverMeta.menuId.trim()) {
        return { ok: false, message: "게시판 ID 를 입력해주세요." } as const;
      }
      if (!naverMeta.subject.trim()) {
        return { ok: false, message: "게시글 제목을 입력해주세요." } as const;
      }
      if (naverMeta.subject.length > NAVER_SUBJECT_MAX_LENGTH) {
        return {
          ok: false,
          message: `제목은 ${NAVER_SUBJECT_MAX_LENGTH}자 이내여야 합니다.`,
        } as const;
      }
    }
    return { ok: true } as const;
  }, [activePlatform, naverMeta, trimmedBody, xValidation]);

  const handleSubmit = () => {
    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }
    const body: CreateScheduleSnsPublicationRequest = {
      platform: activePlatform,
      publishBody,
      ...(activePlatform === "NAVER_CAFE" && {
        targetMeta: {
          cafeId: naverMeta.cafeId.trim(),
          menuId: naverMeta.menuId.trim(),
          subject: naverMeta.subject.trim(),
          openYn: naverMeta.openYn,
        },
      }),
    };
    publish.mutate({ renderId, body });
  };

  // 가용 플랫폼이 1개 이하이면 탭 UI 자체는 보이되 단일 탭 표시 (UX 일관성).
  // 0개면 호출 측이 다이얼로그를 띄우지 않으므로 이 경로는 실행되지 않는 게 정상.
  const showTabs = availablePlatforms.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        // F14: 모바일에서 본문이 길어지는 경우(NAVER_CAFE 메타 + 가이드 등)
        // viewport 보다 길어 잘릴 수 있어 max-h + overflow-y-auto 로 스크롤 보장.
        // 데스크톱(>=sm)도 동일 정책 — 안전한 디폴트.
        className="sm:max-w-xl max-h-[90vh] overflow-y-auto"
        data-testid="render-publish-dialog"
      >
        <DialogHeader>
          <DialogTitle>SNS 게시</DialogTitle>
          <DialogDescription>
            완료된 시간표 이미지를 SNS 에 자동 게시합니다.
          </DialogDescription>
        </DialogHeader>

        {showTabs ? (
          <Tabs
            value={activePlatform}
            onValueChange={(v) => setActivePlatform(v as SnsPlatform)}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2">
              {availablePlatforms.map((p) => (
                <TabsTrigger key={p} value={p} disabled={publish.isPending}>
                  {PLATFORM_LABEL[p]}
                </TabsTrigger>
              ))}
            </TabsList>

            {availablePlatforms.map((p) => (
              <TabsContent
                key={p}
                value={p}
                className="space-y-4 pt-2"
                data-testid={`render-publish-tab-${p}`}
              >
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor={`publish-body-${p}`}>본문</Label>
                    {p === "X" && (
                      <span
                        className={
                          xValidation.weightedLength > X_TWEET_MAX_LENGTH
                            ? "text-xs text-destructive"
                            : "text-xs text-muted-foreground"
                        }
                        data-testid="x-char-count"
                        aria-label={`X 가중 글자수 ${xValidation.weightedLength}/${X_TWEET_MAX_LENGTH}`}
                      >
                        X 가중 글자수 {xValidation.weightedLength}/
                        {X_TWEET_MAX_LENGTH}
                      </span>
                    )}
                  </div>
                  <Textarea
                    id={`publish-body-${p}`}
                    value={publishBody}
                    onChange={(e) => setPublishBody(e.target.value)}
                    placeholder={PLATFORM_BODY_PLACEHOLDER[p]}
                    rows={p === "NAVER_CAFE" ? 8 : 5}
                    disabled={publish.isPending}
                    aria-invalid={
                      p === "X" && !xValidation.valid && trimmedBody.length > 0
                        ? true
                        : undefined
                    }
                  />
                </div>

                {p === "NAVER_CAFE" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="naver-cafe-id">카페 ID</Label>
                        <Input
                          id="naver-cafe-id"
                          inputMode="numeric"
                          value={naverMeta.cafeId}
                          onChange={(e) =>
                            setNaverMeta((m) => ({
                              ...m,
                              cafeId: e.target.value,
                            }))
                          }
                          placeholder="예: 12345678"
                          disabled={publish.isPending}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="naver-menu-id">게시판 ID</Label>
                        <Input
                          id="naver-menu-id"
                          inputMode="numeric"
                          value={naverMeta.menuId}
                          onChange={(e) =>
                            setNaverMeta((m) => ({
                              ...m,
                              menuId: e.target.value,
                            }))
                          }
                          placeholder="예: 12"
                          disabled={publish.isPending}
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="naver-subject">제목</Label>
                      <Input
                        id="naver-subject"
                        value={naverMeta.subject}
                        onChange={(e) =>
                          setNaverMeta((m) => ({
                            ...m,
                            subject: e.target.value,
                          }))
                        }
                        placeholder="게시글 제목"
                        maxLength={NAVER_SUBJECT_MAX_LENGTH}
                        disabled={publish.isPending}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="space-y-0.5">
                        <Label
                          htmlFor="naver-open-yn"
                          className="text-sm font-medium"
                        >
                          전체공개
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          끄면 카페 회원만 볼 수 있어요.
                        </p>
                      </div>
                      <Switch
                        id="naver-open-yn"
                        checked={naverMeta.openYn}
                        onCheckedChange={(v) =>
                          setNaverMeta((m) => ({ ...m, openYn: v }))
                        }
                        disabled={publish.isPending}
                      />
                    </div>
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={publish.isPending}
          >
            취소
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={publish.isPending || !validation.ok}
            data-testid="render-publish-submit"
          >
            {publish.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                요청 중…
              </>
            ) : (
              <>
                <Send className="size-4" />
                게시하기
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
