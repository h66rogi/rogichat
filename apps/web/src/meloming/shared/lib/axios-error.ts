// Axios 에러 타입 정의
export interface AxiosError extends Error {
  response?: {
    status: number;
    data: unknown;
  };
}

// 에러가 Axios 에러인지 확인하는 타입 가드
export function isAxiosError(error: unknown): error is AxiosError {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as AxiosError).response?.status === "number"
  );
}
