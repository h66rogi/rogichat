"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import {
  Send,
  Sparkles,
  Loader2,
  StopCircle,
  ChevronDown,
  Bot,
  Check,
  Pencil,
} from "lucide-react";
import { Button } from "@/meloming/shared/components/ui/button";
import { Textarea } from "@/meloming/shared/components/ui/textarea";
import { Input } from "@/meloming/shared/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/meloming/shared/components/ui/dropdown-menu";
import { cn } from "@/meloming/shared/lib/utils";
import type {
  ModelInfo,
  ParsedAIResponse,
  ClarificationQuestion,
  UserAnswers,
  CSSGenerationUsage,
} from "@/meloming/domains/css-agent/types";

// =============================================================================
// Types
// =============================================================================

type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  timestamp?: string;
  parsed?: ParsedAIResponse;
};

interface AiMainPanelProps {
  models: ModelInfo[];
  selectedModel: string;
  onModelChange: (modelKey: string) => void;
  isLoadingModels?: boolean;
  aiPrompt: string;
  setAiPrompt: (value: string) => void;
  aiMessages: AiMessage[];
  setAiMessages: React.Dispatch<React.SetStateAction<AiMessage[]>>;
  aiIsStreaming: boolean;
  aiIsRequesting: boolean;
  aiConversationId?: string;
  aiMeta: {
    tokens_used?: number;
    processing_time?: number;
    model?: string;
  };
  usage?: CSSGenerationUsage | null;
  onSendMessage: (customMessage?: string) => void;
  onStopStream: () => void;
  onReset: () => void;
}

const samplePrompts = [
  { text: "채널을 예쁘게 꾸며줘", emoji: "✨" },
  { text: "다크 모드 테마로 바꿔줘", emoji: "🌙" },
  { text: "귀여운 파스텔톤으로 만들어줘", emoji: "🎀" },
  { text: "사이버펑크 느낌으로 바꿔줘", emoji: "🌆" },
  { text: "깔끔하고 미니멀하게", emoji: "⚪" },
  { text: "레트로 감성으로", emoji: "📼" },
];

// =============================================================================
// Helper: Parse AI Response
// =============================================================================

function parseAIResponse(content: string): ParsedAIResponse | null {
  try {
    // JSON 블록 추출 시도
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]) as ParsedAIResponse;
    }

    // 직접 JSON 파싱 시도
    const trimmed = content.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return JSON.parse(trimmed) as ParsedAIResponse;
    }

    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Component: Clarification Card
// =============================================================================

interface ClarificationCardProps {
  questions: ClarificationQuestion[];
  onSubmit: (answers: UserAnswers) => void;
  disabled?: boolean;
}

function ClarificationCard({
  questions,
  onSubmit,
  disabled,
}: ClarificationCardProps) {
  const [answers, setAnswers] = useState<UserAnswers>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [showCustom, setShowCustom] = useState<Record<string, boolean>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSelect = (questionId: string, value: string) => {
    if (isSubmitted || disabled) return;

    if (value === "__custom__") {
      setShowCustom((prev) => ({ ...prev, [questionId]: true }));
    } else {
      setAnswers((prev) => ({ ...prev, [questionId]: value }));
      setShowCustom((prev) => ({ ...prev, [questionId]: false }));
    }
  };

  const handleCustomInput = (questionId: string, value: string) => {
    setCustomInputs((prev) => ({ ...prev, [questionId]: value }));
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const allAnswered = questions.every((q) => answers[q.id]);

  const handleSubmit = () => {
    if (allAnswered && !isSubmitted) {
      setIsSubmitted(true);
      onSubmit(answers);
    }
  };

  // 이미 제출됐으면 제출 완료 UI 표시
  if (isSubmitted) {
    return (
      <div className="p-4 bg-card border rounded-xl text-center text-muted-foreground">
        <Check className="size-5 mx-auto mb-2 text-green-500" />
        <span className="text-sm">응답 완료</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 bg-card border rounded-xl">
      {questions.map((q) => (
        <div key={q.id} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-0.5 bg-primary/10 text-primary rounded">
              {q.label}
            </span>
            <span className="text-sm font-medium">{q.question}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {q.options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(q.id, opt.value)}
                disabled={disabled}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-lg border transition-all",
                  answers[q.id] === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-accent border-border"
                )}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => handleSelect(q.id, "__custom__")}
              disabled={disabled}
              className={cn(
                "px-3 py-1.5 text-sm rounded-lg border transition-all",
                showCustom[q.id]
                  ? "bg-secondary border-primary"
                  : "bg-background hover:bg-accent border-border"
              )}
            >
              직접 입력
            </button>
          </div>

          {showCustom[q.id] && (
            <Input
              placeholder="원하는 스타일을 직접 입력하세요..."
              value={customInputs[q.id] || ""}
              onChange={(e) => handleCustomInput(q.id, e.target.value)}
              disabled={disabled}
              className="mt-2"
            />
          )}
        </div>
      ))}

      <Button
        onClick={handleSubmit}
        disabled={!allAnswered || disabled}
        className="w-full gap-2"
      >
        <Check className="size-4" />
        선택 완료
      </Button>
    </div>
  );
}

// =============================================================================
// Component: Message Bubble
// =============================================================================

interface MessageBubbleProps {
  message: AiMessage;
  onClarificationSubmit?: (answers: UserAnswers) => void;
  disabled?: boolean;
}

function MessageBubble({
  message,
  onClarificationSubmit,
  disabled,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const parsed = message.parsed;

  // 사용자 메시지
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm bg-indigo-500 text-white">
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        </div>
      </div>
    );
  }

  // AI 메시지 - 명확화 질문
  if (parsed?.type === "clarification") {
    return (
      <div className="flex gap-3 justify-start">
        <div className="size-8 rounded-full bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
          <Sparkles className="size-4 text-indigo-500" />
        </div>
        <div className="max-w-[90%] space-y-3">
          <div className="text-sm text-muted-foreground">{parsed.message}</div>
          <ClarificationCard
            questions={parsed.questions}
            onSubmit={onClarificationSubmit || (() => {})}
            disabled={disabled}
          />
        </div>
      </div>
    );
  }

  // AI 메시지 - CSS 부분 수정
  if (parsed?.type === "css_patch") {
    return (
      <div className="flex gap-3 justify-start">
        <div className="size-8 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
          <Pencil className="size-4 text-amber-500" />
        </div>
        <div className="max-w-[90%] space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-0.5 bg-amber-500/10 text-amber-600 rounded">
              스타일 수정 완료
            </span>
          </div>
          <p className="text-sm">{parsed.message}</p>
          <p className="text-xs text-muted-foreground">
            미리보기에서 결과를 확인하세요.
          </p>
        </div>
      </div>
    );
  }

  // AI 메시지 - CSS 전체 결과
  if (parsed?.type === "css_result") {
    return (
      <div className="flex gap-3 justify-start">
        <div className="size-8 rounded-full bg-green-500/10 flex items-center justify-center flex-shrink-0">
          <Sparkles className="size-4 text-green-500" />
        </div>
        <div className="max-w-[90%] space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-0.5 bg-green-500/10 text-green-600 rounded">
              전체 CSS 생성
            </span>
            <span className="text-sm font-medium">{parsed.summary}</span>
          </div>
          {parsed.description && (
            <p className="text-sm text-muted-foreground">{parsed.description}</p>
          )}
          <div className="text-xs text-muted-foreground">
            미리보기에서 결과를 확인하세요. 마음에 들면 저장 버튼을 눌러주세요.
          </div>
        </div>
      </div>
    );
  }

  // AI 메시지 - 일반 메시지
  if (parsed?.type === "message") {
    return (
      <div className="flex gap-3 justify-start">
        <div className="size-8 rounded-full bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
          <Sparkles className="size-4 text-indigo-500" />
        </div>
        <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm bg-muted">
          <div className="whitespace-pre-wrap break-words">{parsed.content}</div>
        </div>
      </div>
    );
  }

  // 스트리밍 중 - 사용자 친화적 메시지만 표시
  if (message.streaming) {
    return (
      <div className="flex gap-3 justify-start">
        <div className="size-8 rounded-full bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
          <Loader2 className="size-4 text-indigo-500 animate-spin" />
        </div>
        <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm bg-muted">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span>AI가 디자인 작업 중</span>
            <span className="animate-pulse">...</span>
          </div>
        </div>
      </div>
    );
  }

  // 파싱 안 된 일반 텍스트 (스트리밍 완료 후 파싱 실패 시)
  return (
    <div className="flex gap-3 justify-start">
      <div className="size-8 rounded-full bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
        <Sparkles className="size-4 text-indigo-500" />
      </div>
      <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm bg-muted">
        <div className="whitespace-pre-wrap break-words">
          {message.content || "응답을 처리하는 중..."}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function AiMainPanel({
  models,
  selectedModel,
  onModelChange,
  isLoadingModels,
  aiPrompt,
  setAiPrompt,
  aiMessages,
  setAiMessages,
  aiIsStreaming,
  aiIsRequesting,
  aiMeta,
  usage,
  onSendMessage,
  onStopStream,
  onReset,
}: AiMainPanelProps) {
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const selectedModelInfo = models.find((m) => m.key === selectedModel);

  useEffect(() => {
    if (chatListRef.current) {
      chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
    }
  }, [aiMessages]);

  // 마지막 clarification 메시지에서 질문 정보 가져오기
  const getLastClarificationQuestions = useCallback((): ClarificationQuestion[] => {
    for (let i = aiMessages.length - 1; i >= 0; i--) {
      const msg = aiMessages[i];
      if (msg.role === "assistant" && msg.parsed?.type === "clarification") {
        return msg.parsed.questions;
      }
    }
    return [];
  }, [aiMessages]);

  // 명확화 질문 응답 처리
  const handleClarificationSubmit = useCallback(
    (answers: UserAnswers) => {
      const questions = getLastClarificationQuestions();

      // 질문 라벨과 함께 답변 포맷팅
      const formattedAnswers = Object.entries(answers)
        .map(([questionId, value]) => {
          const question = questions.find((q) => q.id === questionId);
          if (question) {
            return `${question.label}: ${value}`;
          }
          return value;
        })
        .join("\n");

      // 사용자 메시지로 전송 (더 명확한 맥락 제공)
      const answerText = `선택한 답변:\n${formattedAnswers}`;
      onSendMessage(answerText);
    },
    [onSendMessage, getLastClarificationQuestions]
  );

  // 스트리밍 상태 추적
  const isAnyStreaming = aiMessages.some((m) => m.streaming);

  // 메시지 파싱 (스트리밍 완료 후)
  useEffect(() => {
    // 스트리밍 중이면 파싱하지 않음
    if (isAnyStreaming) return;

    // 파싱이 필요한 메시지가 있는지 확인
    const needsParsing = aiMessages.some(
      (msg) => msg.role === "assistant" && !msg.parsed && msg.content
    );

    if (!needsParsing) return;

    setAiMessages((prev) => {
      let hasChanges = false;
      const updated = prev.map((msg) => {
        if (msg.role === "assistant" && !msg.parsed && msg.content) {
          const parsed = parseAIResponse(msg.content);
          if (parsed) {
            hasChanges = true;
            return { ...msg, parsed };
          }
        }
        return msg;
      });
      return hasChanges ? updated : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnyStreaming]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 h-8 px-2 -ml-2"
              disabled={isLoadingModels}
            >
              <div className="size-6 rounded-md bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                <Bot className="size-3.5 text-white" />
              </div>
              {isLoadingModels ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <>
                  <span className="text-sm font-medium">
                    {selectedModelInfo?.name || "모델 선택"}
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {models.map((model) => (
              <DropdownMenuItem
                key={model.key}
                onClick={() => onModelChange(model.key)}
                className={cn(
                  "flex flex-col items-start gap-0.5 py-2",
                  selectedModel === model.key && "bg-accent"
                )}
              >
                <span className="font-medium text-sm">{model.name}</span>
                <span className="text-xs text-muted-foreground">
                  {model.description}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-3">
          {/* 사용량 표시 */}
          {usage && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  "font-medium",
                  usage.remaining <= 0
                    ? "text-destructive"
                    : usage.remaining <= 2
                      ? "text-amber-500"
                      : "text-foreground"
                )}
              >
                {usage.remaining}/{usage.limit}
              </span>
              <span>회 남음</span>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={aiIsRequesting || aiMessages.length === 0}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            새 대화
          </Button>
        </div>
      </div>

      {/* Chat messages */}
      <div ref={chatListRef} className="flex-1 overflow-auto p-4 space-y-4">
        {aiMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="relative mb-6">
              <div className="size-20 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center">
                <Sparkles className="size-10 text-indigo-500" />
              </div>
              <div className="absolute -bottom-1 -right-1 size-6 rounded-full bg-green-500 flex items-center justify-center ring-2 ring-background">
                <Bot className="size-3.5 text-white" />
              </div>
            </div>
            <h3 className="text-xl font-semibold mb-2">채널 스타일링 시작하기</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-8">
              원하는 분위기나 스타일을 알려주세요.<br />
              AI가 맞춤 디자인을 만들어드릴게요.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-xl w-full px-4">
              {samplePrompts.map((prompt) => (
                <button
                  key={prompt.text}
                  type="button"
                  className="group flex items-center gap-2 text-left text-sm px-3 py-2.5 rounded-xl border bg-card hover:bg-accent hover:border-indigo-500/30 transition-all"
                  onClick={() => setAiPrompt(prompt.text)}
                  disabled={aiIsStreaming || aiIsRequesting}
                >
                  <span className="text-base group-hover:scale-110 transition-transform">{prompt.emoji}</span>
                  <span className="truncate">{prompt.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          aiMessages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onClarificationSubmit={handleClarificationSubmit}
              disabled={aiIsRequesting}
            />
          ))
        )}
      </div>

      {/* Input area */}
      <div className="border-t p-3 bg-background">
        <div className="relative flex items-end gap-2">
          <div className="relative flex-1">
            <Textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="원하는 스타일을 설명해주세요..."
              className="min-h-[52px] max-h-32 resize-none pr-12 rounded-xl border-muted-foreground/20 focus:border-indigo-500 transition-colors"
              disabled={aiIsRequesting}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSendMessage();
                }
              }}
            />
            {aiIsStreaming ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={onStopStream}
                className="absolute right-2 bottom-2 size-8 rounded-lg hover:bg-destructive/10 text-destructive"
              >
                <StopCircle className="size-5" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                onClick={() => onSendMessage()}
                disabled={aiIsRequesting || !aiPrompt.trim()}
                className={cn(
                  "absolute right-2 bottom-2 size-8 rounded-lg transition-all",
                  aiPrompt.trim()
                    ? "bg-indigo-500 hover:bg-indigo-600 text-white shadow-md"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {aiIsRequesting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
