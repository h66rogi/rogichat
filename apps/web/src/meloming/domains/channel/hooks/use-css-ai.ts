import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  postCssAgentChatStream,
  getCssAgentModels,
  getCssGenerationUsageStatus,
} from "@/meloming/domains/css-agent/apis/css-agent";
import type {
  ChatStreamChunk,
  ModelInfo,
  ParsedAIResponse,
  CssPatch,
  CSSGenerationUsage,
} from "@/meloming/domains/css-agent/types";
import { parseCssStructure, cssStructureToPrompt } from "@/meloming/domains/channel/utils/css-parser";

export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  timestamp?: string;
  parsed?: ParsedAIResponse;
};

interface UseCssAiOptions {
  channelId?: number;
  isOwnerPro?: boolean;
  onCssGenerated?: (css: string, isPatch: boolean, patchInfo?: { applied: number; failed: string[] }) => void;
  onUsageLimitReached?: (usage: CSSGenerationUsage) => void;
}

export function useCssAi(options: UseCssAiOptions = {}) {
  const { channelId, isOwnerPro = false, onCssGenerated, onUsageLimitReached } = options;

  // 모델 상태
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [isLoadingModels, setIsLoadingModels] = useState(true);

  // AI 상태
  const [prompt, setPrompt] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [includeCurrentCss, setIncludeCurrentCss] = useState(true);
  const [meta, setMeta] = useState<{
    tokens_used?: number;
    processing_time?: number;
    model?: string;
  }>({});
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  // Rate Limit 상태
  const [usage, setUsage] = useState<CSSGenerationUsage | null>(null);
  const [isLimitReached, setIsLimitReached] = useState(false);

  const streamControllerRef = useRef<AbortController | null>(null);

  const updateUsage = useCallback(
    (nextUsage: CSSGenerationUsage | null) => {
      setUsage(nextUsage);
      setIsLimitReached(Boolean(nextUsage && nextUsage.remaining <= 0));
    },
    []
  );

  // 모델 목록 로드
  const loadModels = useCallback(async () => {
    try {
      const data = await getCssAgentModels();
      setModels(data);
    } catch (error) {
      console.error("Failed to load models:", error);
      setModels([
        {
          key: "auto",
          id: "auto",
          name: "AI Auto",
          description: "빠른 모델 자동 선택 (추천)",
        },
      ]);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  const loadUsageStatus = useCallback(async () => {
    if (!channelId) {
      updateUsage(null);
      return null;
    }

    try {
      const nextUsage = await getCssGenerationUsageStatus({
        channel_id: channelId,
        is_owner_pro: isOwnerPro,
      });
      updateUsage(nextUsage);
      return nextUsage;
    } catch (error) {
      console.error("Failed to load CSS generation usage:", error);
      return null;
    }
  }, [channelId, isOwnerPro, updateUsage]);

  useEffect(() => {
    void loadUsageStatus();
  }, [loadUsageStatus]);

  useEffect(() => {
    if (!usage?.resets_at || usage.remaining > 0) return;

    const resetAt = new Date(usage.resets_at).getTime();
    const delay = resetAt - Date.now();
    if (delay <= 0) {
      void loadUsageStatus();
      return;
    }

    const timer = window.setTimeout(() => {
      void loadUsageStatus();
    }, delay + 1000);

    return () => window.clearTimeout(timer);
  }, [loadUsageStatus, usage]);

  // CSS 패치 적용
  const applyCssPatches = useCallback(
    (currentCss: string, patches: CssPatch[]): { css: string; applied: number; failed: string[] } => {
      let result = currentCss;
      let applied = 0;
      const failed: string[] = [];

      for (const patch of patches) {
        if (result.includes(patch.find)) {
          result = result.replace(patch.find, patch.replace);
          applied++;
        } else {
          failed.push(patch.find.slice(0, 50) + (patch.find.length > 50 ? "..." : ""));
        }
      }

      return { css: result, applied, failed };
    },
    []
  );

  // AI 응답 처리
  const processCssFromResponse = useCallback(
    (
      text: string,
      currentCss: string
    ): { css: string; isPatch: boolean; patchInfo?: { applied: number; failed: string[] } } | null => {
      try {
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        let parsed: ParsedAIResponse | null = null;

        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1]);
        } else {
          const trimmed = text.trim();
          if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            parsed = JSON.parse(trimmed);
          }
        }

        if (!parsed) return null;

        if (parsed.type === "css_patch" && parsed.patches) {
          const result = applyCssPatches(currentCss, parsed.patches);
          return {
            css: result.css,
            isPatch: true,
            patchInfo: { applied: result.applied, failed: result.failed },
          };
        }

        if (parsed.type === "css_result" && parsed.css) {
          return { css: parsed.css, isPatch: false };
        }

        return null;
      } catch {
        const match = text.match(/```css([\s\S]*?)```/i);
        if (match && match[1]) {
          return { css: match[1].trim(), isPatch: false };
        }
        return null;
      }
    },
    [applyCssPatches]
  );

  // 메시지 전송
  const sendMessage = useCallback(
    async (currentCss: string, customMessage?: string) => {
      const trimmed = (customMessage || prompt).trim();
      if (!trimmed) {
        toast.error("요청할 내용을 입력해주세요.");
        return;
      }

      const userId = `user-${Date.now()}`;
      const assistantId = `assistant-${Date.now()}`;

      // CSS 구조 분석
      let cssStructure: string | undefined;
      if (includeCurrentCss && currentCss) {
        const structure = parseCssStructure(currentCss);
        cssStructure = cssStructureToPrompt(structure);
      }

      const nextConversationId =
        conversationId ||
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `css-${Date.now()}-${Math.random().toString(36).slice(2)}`);

      if (!conversationId) {
        setConversationId(nextConversationId);
      }

      const payload = {
        message: trimmed,
        conversation_id: nextConversationId,
        current_css: includeCurrentCss ? currentCss : undefined,
        css_structure: cssStructure,
        model: selectedModel,
        channel_id: channelId,
        is_owner_pro: isOwnerPro,
      };

      const timestamp = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: trimmed, timestamp },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      setIsStreaming(true);
      setIsRequesting(true);

      const controller = new AbortController();
      streamControllerRef.current = controller;
      let streamedContent = "";

      const streamPromise = postCssAgentChatStream(payload, {
        signal: controller.signal,
        onMessage: (chunk: ChatStreamChunk) => {
          // Rate Limit 초과 에러 처리
          if (chunk.error === "css_generation_limit_exceeded" && chunk.usage) {
            updateUsage(chunk.usage);
            onUsageLimitReached?.(chunk.usage);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: "CSS 생성 횟수 제한에 도달했습니다.", streaming: false }
                  : m
              )
            );
            return;
          }
          if (chunk.error) {
            toast.error(chunk.error);
            return;
          }
          if (chunk.model) {
            setMeta((prev) => ({
              ...prev,
              model: chunk.model,
            }));
          }
          // Usage 정보 업데이트
          if (chunk.usage) {
            updateUsage(chunk.usage);
          }
          if (chunk.content) {
            streamedContent += chunk.content;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: streamedContent } : m
              )
            );
          }
        },
        onDone: () => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, streaming: false } : m
            )
          );
          if (streamedContent && onCssGenerated) {
            const result = processCssFromResponse(streamedContent, currentCss);
            if (result) {
              onCssGenerated(result.css, result.isPatch, result.patchInfo);
            }
          }
          setIsStreaming(false);
          streamControllerRef.current = null;
        },
        onError: (err) => {
          console.error(err);
          toast.error("스트리밍 중 오류가 발생했습니다.");
          setIsStreaming(false);
          streamControllerRef.current = null;
        },
      });

      try {
        await streamPromise;
        if (streamedContent) {
          toast.success("AI가 CSS를 생성했습니다. 미리보기에서 확인하세요.");
        }
      } finally {
        setIsRequesting(false);
        setPrompt("");
      }
    },
    [channelId, isOwnerPro, conversationId, includeCurrentCss, prompt, selectedModel, onCssGenerated, onUsageLimitReached, processCssFromResponse, updateUsage]
  );

  // 스트리밍 중지
  const stopStream = useCallback(() => {
    if (streamControllerRef.current) {
      streamControllerRef.current.abort();
      streamControllerRef.current = null;
    }
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  }, []);

  // 대화 초기화
  const reset = useCallback(() => {
    setPrompt("");
    setMessages([]);
    setConversationId(undefined);
    setMeta({});
  }, []);

  return {
    // 모델
    models,
    selectedModel,
    setSelectedModel,
    isLoadingModels,
    loadModels,

    // AI 상태
    prompt,
    setPrompt,
    messages,
    setMessages,
    isStreaming,
    isRequesting,
    conversationId,
    meta,
    includeCurrentCss,
    setIncludeCurrentCss,

    // Rate Limit 상태
    usage,
    isLimitReached,
    loadUsageStatus,

    // 액션
    sendMessage,
    stopStream,
    reset,
  };
}
