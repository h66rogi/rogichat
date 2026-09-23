import axios from "axios";
import {
  normalizeAxiosErrorMessage,
  throwApiResponseError,
} from "@/meloming/shared/lib/api-error";
import type {
  ModelInfo,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  FontSearchRequest,
  FontSearchResponse,
  CssValidateRequest,
  CssValidateResponse,
  CssAnalyzeRequest,
  CssAnalyzeResponse,
  ConversationHistoryResponse,
  CSSGenerationUsage,
} from "../types";

// Agent API 직접 호출 (JWT 쿠키 인증)
const AGENT_BASE_URL = process.env.NEXT_PUBLIC_CSS_AGENT_BASE_URL || "";
const API_PREFIX = "/api/v1/css-agent";

// Agent API 전용 클라이언트
const agentApiClient = axios.create({
  baseURL: AGENT_BASE_URL,
  timeout: 60000,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // 쿠키 기반 JWT 인증
});

agentApiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    normalizeAxiosErrorMessage(error);
    return Promise.reject(error);
  }
);

// Clamp timeout to avoid excessively long hangs (min 5s, max 60s, default 20s)
const parsedTimeout = Number(process.env.NEXT_PUBLIC_CSS_AGENT_TIMEOUT_MS);
const TIMEOUT_MS = Number.isFinite(parsedTimeout)
  ? Math.min(Math.max(parsedTimeout, 5000), 60000)
  : 60000; // AI 응답은 더 오래 걸릴 수 있음

export async function postCssAgentChat(
  payload: ChatRequest
): Promise<ChatResponse> {
  const response = await agentApiClient.post<ChatResponse>(
    `${API_PREFIX}/chat`,
    payload,
    {
      timeout: TIMEOUT_MS,
    }
  );
  return response.data;
}

/**
 * SSE streaming chat
 * onMessage: called per chunk
 * onDone: called when [DONE] or stream end
 */
export async function postCssAgentChatStream(
  payload: ChatRequest,
  handlers: {
    onMessage: (chunk: ChatStreamChunk) => void;
    onDone?: () => void;
    onError?: (error: unknown) => void;
    signal?: AbortSignal;
  }
) {
  const controller = new AbortController();
  const signal = handlers.signal ?? controller.signal;

  try {
    const resp = await fetch(`${AGENT_BASE_URL}${API_PREFIX}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include", // 쿠키 기반 인증
      body: JSON.stringify(payload),
      signal,
    });

    if (!resp.ok) {
      await throwApiResponseError(resp, "CSS 에이전트 응답을 처리하지 못했습니다");
    }

    if (!resp.body) {
      throw new Error("No response body for SSE stream");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const line = part.trim();
        if (!line) continue;
        if (line === "data: [DONE]") {
          handlers.onDone?.();
          return;
        }
        if (line.startsWith("data:")) {
          const json = line.slice(5).trim();
          try {
            const parsed = JSON.parse(json) as ChatStreamChunk;
            handlers.onMessage(parsed);
          } catch (err) {
            handlers.onError?.(err);
          }
        }
      }
    }

    handlers.onDone?.();
  } catch (error) {
    handlers.onError?.(error);
    throw error;
  } finally {
    if (!handlers.signal) controller.abort();
  }
}

export async function postCssAgentFontSearch(
  payload: FontSearchRequest
): Promise<FontSearchResponse> {
  const response = await agentApiClient.post<FontSearchResponse>(
    `${API_PREFIX}/tools/fonts/search`,
    payload,
    { timeout: TIMEOUT_MS }
  );
  return response.data;
}

export async function postCssAgentValidateCss(
  payload: CssValidateRequest
): Promise<CssValidateResponse> {
  const response = await agentApiClient.post<CssValidateResponse>(
    `${API_PREFIX}/tools/css/validate`,
    payload,
    { timeout: TIMEOUT_MS }
  );
  return response.data;
}

export async function postCssAgentAnalyzeCss(
  payload: CssAnalyzeRequest
): Promise<CssAnalyzeResponse> {
  const response = await agentApiClient.post<CssAnalyzeResponse>(
    `${API_PREFIX}/tools/css/analyze`,
    payload,
    { timeout: TIMEOUT_MS }
  );
  return response.data;
}

export async function getCssAgentConversationHistory(
  conversationId: string
): Promise<ConversationHistoryResponse> {
  const response = await agentApiClient.get<ConversationHistoryResponse>(
    `${API_PREFIX}/conversations/${conversationId}`,
    { timeout: TIMEOUT_MS }
  );
  return response.data;
}

export async function deleteCssAgentConversation(conversationId: string) {
  const response = await agentApiClient.delete<{ message: string }>(
    `${API_PREFIX}/conversations/${conversationId}`,
    { timeout: TIMEOUT_MS }
  );
  return response.data;
}

export async function getCssGenerationUsageStatus(payload: {
  channel_id: number;
  is_owner_pro: boolean;
}): Promise<CSSGenerationUsage> {
  const response = await agentApiClient.post<CSSGenerationUsage>(
    `${API_PREFIX}/usage-status`,
    payload,
    { timeout: TIMEOUT_MS }
  );
  return response.data;
}

// 모델 목록 조회
export async function getCssAgentModels(): Promise<ModelInfo[]> {
  const response = await agentApiClient.get<ModelInfo[]>(
    `${API_PREFIX}/models`,
    { timeout: TIMEOUT_MS }
  );
  return response.data;
}
