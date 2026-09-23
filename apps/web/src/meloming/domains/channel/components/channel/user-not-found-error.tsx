import { Alert, AlertDescription } from "@/meloming/shared/components/ui/alert";
import { AlertTriangle, Home } from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";

/**
 * 유저가 존재하지 않을 때 표시할 에러 페이지
 */
export default function UserNotFoundError() {
  return (
    <div className="container mx-auto py-12 px-4 md:px-6">
      <div className="max-w-md mx-auto">
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-base">
            <strong>사용자를 찾을 수 없습니다</strong>
            <br />
            입력하신 주소를 다시 확인해주세요.
          </AlertDescription>
        </Alert>

        <div className="flex justify-center">
          <Button
            onClick={() => (window.location.href = "/")}
            variant="outline"
            className="gap-2"
          >
            <Home size={16} />
            홈으로 돌아가기
          </Button>
        </div>
      </div>
    </div>
  );
}
