"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { LiveConsoleContent } from "@/meloming/domains/overlay/components/live-console-content";
import { useAuth } from "@/meloming/domains/auth/hooks/use-auth";
import { apiClient, CONSOLE_TOKEN_FLAG } from "@/meloming/shared/lib/api-client";
import { Loader2, KeyRound } from "lucide-react";
import { Input } from "@/meloming/shared/components/ui/input";
import { Button } from "@/meloming/shared/components/ui/button";

export default function LiveConsolePopupPage({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const consoleToken = searchParams.get("token");

  // JWT 인증은 콘솔 토큰이 없을 때만 활성화
  const { user: authUser, isLoading: authLoading } = useAuth(!consoleToken);

  const [username, setUsername] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [isValidatingToken, setIsValidatingToken] = useState(false);
  const [tokenValid, setTokenValid] = useState(false);

  // params resolve
  useEffect(() => {
    void params.then((p) => {
      setUsername(p.user);
    });
  }, [params]);

  // 콘솔 토큰 모드: axios request interceptor 설정
  useEffect(() => {
    if (!consoleToken) return;

    const reqId = apiClient.interceptors.request.use((config) => {
      const url = config.url ?? "";

      // song-live/sessions → console-api/sessions
      if (url.startsWith("/song-live/sessions")) {
        config.url = url.replace("/song-live/sessions", "/console-api/sessions");
      }
      // song-requests → console-api/song-requests
      if (url.startsWith("/song-requests")) {
        config.url = url.replace("/song-requests", "/console-api/song-requests");
      }

      const finalUrl = config.url ?? "";

      // 콘솔 토큰으로 접근 가능한 엔드포인트 목록.
      // - console-api 전용 경로: 세션/신청곡 CRUD (URL rewrite 후)
      // - overlay-theme / overlay-layouts: 콘솔 팝업 오버레이 탭에서 설정 편집용.
      //   백엔드는 JwtOrConsoleTokenGuard가 token 쿼리를 보고 console 모드를 허용.
      const needsConsoleAuth =
        finalUrl.startsWith("/console-api") ||
        /^\/channel\/[^/]+\/overlay-theme(\/|$|\?)/.test(finalUrl) ||
        /^\/channel\/[^/]+\/overlay-layouts(\/|$|\?)/.test(finalUrl);

      if (needsConsoleAuth) {
        config.params = { ...config.params, token: consoleToken };
        config.withCredentials = false;
        (config as unknown as Record<string, unknown>)[CONSOLE_TOKEN_FLAG] = true;
      }

      return config;
    });

    return () => {
      apiClient.interceptors.request.eject(reqId);
    };
  }, [consoleToken]);

  // 콘솔 토큰 검증
  useEffect(() => {
    if (!consoleToken || !username) return;

    let cancelled = false;

    const validateToken = async () => {
      setIsValidatingToken(true);
      try {
        await apiClient.get("/console-api/sessions/active", {
          params: { token: consoleToken },
          withCredentials: false,
        });
        if (cancelled) return;
        setTokenValid(true);
        setIsValidatingToken(false);
      } catch (err: unknown) {
        if (cancelled) return;
        const status =
          typeof err === "object" && err !== null && "response" in err
            ? (err as { response?: { status?: number } }).response?.status
            : undefined;
        if (status === 404) {
          // 활성 세션 없음 — 토큰 자체는 유효
          setTokenValid(true);
          setIsValidatingToken(false);
        } else {
          setTokenError("유효하지 않은 토큰입니다.");
          setIsValidatingToken(false);
        }
      }
    };

    void validateToken();

    return () => {
      cancelled = true;
    };
  }, [consoleToken, username]);

  // 토큰 입력 제출
  const handleTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setTokenError("토큰을 입력해주세요.");
      return;
    }
    router.push(`/console/${username}?token=${encodeURIComponent(trimmed)}`);
  };

  // 로딩 상태
  if (!username || (!consoleToken && authLoading) || (consoleToken && isValidatingToken)) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">
            {consoleToken ? "토큰 확인 중..." : "인증 확인 중..."}
          </p>
        </div>
      </div>
    );
  }

  // 인증 성공 (콘솔 토큰 또는 JWT)
  if ((consoleToken && tokenValid) || authUser) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-background">
        <LiveConsoleContent
          user={username}
          isPopup={true}
        />
      </div>
    );
  }

  // 미인증 상태 → 토큰 입력 폼
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-4">
            <KeyRound className="w-6 h-6 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-bold mb-2">콘솔 접속</h1>
          <p className="text-sm text-muted-foreground">
            콘솔 토큰을 입력하여 접속하세요.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            토큰은 채널 설정에서 발급할 수 있습니다.
          </p>
        </div>

        <form onSubmit={handleTokenSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder="콘솔 토큰 입력"
            value={tokenInput}
            onChange={(e) => {
              setTokenInput(e.target.value);
              setTokenError("");
            }}
            className="h-12"
            autoFocus
          />

          {tokenError && (
            <p className="text-sm text-destructive">{tokenError}</p>
          )}

          <Button type="submit" className="w-full h-12">
            접속
          </Button>
        </form>
      </div>
    </div>
  );
}
