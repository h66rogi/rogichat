// 모델 정보
export interface ModelInfo {
  key: string;
  id: string;
  name: string;
  description: string;
}

// CSS 생성 사용량 정보
export interface CSSGenerationUsage {
  used: number;
  limit: number;
  remaining: number;
  resets_at?: string;
}

export interface ChatRequest {
  message: string;
  conversation_id?: string;
  current_css?: string;
  css_structure?: string; // CSS 구조 분석 정보
  additional_context?: string;
  model?: string; // 모델 키 (gemini-flash, claude-sonnet, etc.)
  channel_id?: number; // Rate Limit 적용 기준
  is_owner_pro?: boolean; // 채널 소유자가 PRO인지 여부
}

export interface ChatResponse {
  response: string;
  conversation_id: string;
  model?: string;
  model_id?: string;
  blocked: boolean;
  blocked_reason?: string;
  tokens_used?: number;
  processing_time?: number;
  usage?: CSSGenerationUsage; // Rate Limit 사용량 정보
}

// Streaming SSE chunk
export interface ChatStreamChunk {
  content?: string;
  error?: string;
  model?: string;      // SSE 첫 청크에서 전송
  model_id?: string;   // SSE 첫 청크에서 전송
  usage?: CSSGenerationUsage; // Rate Limit 사용량 정보
}

export interface FontSearchRequest {
  query?: string;
  limit?: number;
}

export interface FontSearchItem {
  id: number;
  name: string;
  name_en: string;
  description: string;
  creator: string;
  css_import: string;
  font_family: string;
  variants_count: number;
  page_url: string;
}

export interface FontSearchResponse {
  query: string;
  total_fetched: number;
  matched: number;
  count: number;
  fonts: FontSearchItem[];
}

export interface CssValidateRequest {
  css_code: string;
}

export interface CssValidateResponse {
  is_valid: boolean;
  size_bytes: number;
  size_kb: number;
  remaining_bytes: number;
  errors: string[];
  warnings: string[];
  summary: string;
}

export interface CssAnalyzeRequest {
  css_code: string;
}

export interface CssAnalyzeResponse {
  size_bytes: number;
  selectors: string[];
  colors: string[];
  fonts: string[];
  has_animations: boolean;
  has_variables: boolean;
  imports: string[];
}

export interface ConversationMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: string;
}

export interface ConversationHistoryResponse {
  conversation_id: string;
  messages: ConversationMessage[];
}

// =============================================================================
// AI 응답 타입 (고도화된 대화형 시스템)
// =============================================================================

// 질문 옵션
export interface QuestionOption {
  value: string;
  label: string;
}

// 명확화 질문
export interface ClarificationQuestion {
  id: string;
  label: string;
  question: string;
  options: QuestionOption[];
}

// AI 응답 타입 (Union)
export type AIResponseType = "clarification" | "css_patch" | "css_result" | "message";

// 명확화 질문 응답
export interface ClarificationResponse {
  type: "clarification";
  message: string;
  questions: ClarificationQuestion[];
}

// CSS 패치 항목
export interface CssPatch {
  find: string;
  replace: string;
}

// CSS 부분 수정 응답
export interface CssPatchResponse {
  type: "css_patch";
  message: string;
  patches: CssPatch[];
}

// CSS 전체 결과 응답
export interface CssResultResponse {
  type: "css_result";
  summary: string;
  description?: string;
  css: string;
}

// 일반 메시지 응답
export interface MessageResponse {
  type: "message";
  content: string;
}

// AI 파싱된 응답
export type ParsedAIResponse =
  | ClarificationResponse
  | CssPatchResponse
  | CssResultResponse
  | MessageResponse;

// 사용자 선택 답변
export interface UserAnswers {
  [questionId: string]: string;
}
