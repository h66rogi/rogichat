"use client";

import React, { Component, type ReactNode } from "react";
import { Button } from "@/meloming/shared/components/ui/button";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Alert, AlertDescription } from "@/meloming/shared/components/ui/alert";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, resetError: () => void) => ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * 에러 전파를 방지하고 사용자에게 적절한 fallback UI를 제공하는 ErrorBoundary
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error!, this.resetError);
      }

      return (
        <DefaultErrorFallback
          error={this.state.error!}
          resetError={this.resetError}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * 기본 에러 fallback UI 컴포넌트
 */
function DefaultErrorFallback({
  error,
  resetError,
}: {
  error: Error;
  resetError: () => void;
}) {
  const isNetworkError =
    error.message.includes("network") ||
    error.message.includes("fetch") ||
    error.name === "AxiosError";

  return (
    <div className="min-h-96 flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-base">
            {isNetworkError ? (
              <>
                <strong>연결 문제가 발생했습니다</strong>
                <br />
                네트워크 연결을 확인하고 다시 시도해주세요.
              </>
            ) : (
              <>
                <strong>예상치 못한 오류가 발생했습니다</strong>
                <br />
                잠시 후 다시 시도해주세요.
              </>
            )}
          </AlertDescription>
        </Alert>

        <div className="flex flex-col gap-3">
          <Button
            onClick={resetError}
            className="w-full gap-2"
            variant="default"
          >
            <RefreshCw size={16} />
            다시 시도
          </Button>

          <Button
            onClick={() => (window.location.href = "/")}
            variant="outline"
            className="w-full gap-2"
          >
            <Home size={16} />
            홈으로 돌아가기
          </Button>
        </div>

        {process.env.NODE_ENV === "development" && (
          <details className="mt-6 p-4 bg-gray-100 rounded-lg text-sm">
            <summary className="cursor-pointer font-medium text-gray-700 mb-2">
              개발자 정보
            </summary>
            <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words">
              {error.name}: {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * 페이지별 에러 처리를 위한 경량 ErrorBoundary
 */
export function PageErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(error, resetError) => (
        <div className="container mx-auto py-12">
          <DefaultErrorFallback error={error} resetError={resetError} />
        </div>
      )}
      onError={(error, errorInfo) => {
        // 에러 로깅 서비스에 전송 (예: Sentry)
        console.error("Page Error:", error, errorInfo);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * 섹션별 에러 처리를 위한 경량 ErrorBoundary
 */
export function SectionErrorBoundary({
  children,
  section = "섹션",
}: {
  children: ReactNode;
  section?: string;
}) {
  return (
    <ErrorBoundary
      fallback={(error, resetError) => (
        <Alert variant="destructive" className="my-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex justify-between items-start">
              <div>
                <strong>{section} 로딩 중 오류가 발생했습니다</strong>
                <br />
                <span className="text-sm">일시적인 문제일 수 있습니다.</span>
                <br />
                <span className="text-sm">
                  {error.name}: {error.message}
                </span>
              </div>
              <Button
                onClick={resetError}
                variant="outline"
                size="sm"
                className="ml-4 gap-1"
              >
                <RefreshCw size={12} />
                재시도
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * 인라인 에러 표시용 컴포넌트 (API 호출 실패 등)
 */
export function InlineError({
  message = "데이터를 불러올 수 없습니다",
  size = "default",
  className = "",
  onRetry,
  retryLabel = "다시 시도",
}: {
  message?: string;
  size?: "sm" | "default";
  className?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const iconSize = size === "sm" ? 14 : 16;
  const alertClass = size === "sm" ? "py-2 px-3" : "";

  return (
    <Alert variant="destructive" className={`${alertClass} ${className}`}>
      <AlertTriangle className={`h-${iconSize / 4} w-${iconSize / 4}`} />
      <AlertDescription className={size === "sm" ? "text-xs" : "text-sm"}>
        {onRetry ? (
          <div className="flex flex-col gap-3">
            <div>{message}</div>
            <Button
              onClick={onRetry}
              variant="outline"
              size="sm"
              className="self-start gap-1"
            >
              <RefreshCw size={12} />
              {retryLabel}
            </Button>
          </div>
        ) : (
          message
        )}
      </AlertDescription>
    </Alert>
  );
}

