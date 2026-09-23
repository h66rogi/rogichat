"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Search, Music, Plus, Check, AlertCircle, Sparkles } from "lucide-react";
import { useChannel } from "@/meloming/domains/channel/hooks/use-channel";
import {
  useGlobalSongMatch,
  useQuickAddGlobalSong,
  useChannelRecommendations,
} from "@/meloming/domains/channel/hooks/use-global-songs";
import type {
  MatchResult,
  RecommendationItem,
  QuickAddResponse,
} from "@/meloming/domains/channel/apis/global-songs";
import { Input } from "@/meloming/shared/components/ui/input";
import { Button } from "@/meloming/shared/components/ui/button";
import { Badge } from "@/meloming/shared/components/ui/badge";
import { useDebounce } from "@/meloming/shared/hooks/use-debounce";
import { captureIntentEvent } from "@/meloming/shared/analytics/intentional-events";
import {
  countBucket,
  getApiErrorStatus,
  getErrorName,
  getQuickMatchSummary,
  getQuickSearchSummary,
  getRecommendationSummary,
  textLengthBucket,
} from "./songbook-analytics";

type QuickAddProps = {
  channelIdentifier?: string;
  channelIdProp?: number;
};

export function AddSongQuickContent({
  channelIdentifier: channelIdentifierProp,
  channelIdProp,
}: QuickAddProps = {}) {
  const params = useParams();
  const user = params?.user as string | undefined;
  const identifier = channelIdentifierProp ?? user ?? "";

  const { data: publicUser } = useChannel(identifier, {
    enabled: channelIdProp === undefined && identifier.length > 0,
  });
  const channelId = channelIdProp ?? publicUser?.id ?? 0;

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [postAddRecs, setPostAddRecs] = useState<RecommendationItem[]>([]);
  const queryFocusedRef = useRef(false);
  const queryStartedRef = useRef(false);
  const quickViewedEventKeyRef = useRef("");
  const searchResultEventKeyRef = useRef("");
  const postAddRecommendationEventKeyRef = useRef("");
  const channelRecommendationEventKeyRef = useRef("");

  const { data: matchData, isLoading } = useGlobalSongMatch(
    debouncedQuery,
    channelId || undefined,
  );

  const { data: channelRecs } = useChannelRecommendations(channelId);

  const quickAddMutation = useQuickAddGlobalSong(channelId);

  const baseProperties = useMemo(
    () => ({
      channel_id: channelId || null,
      channel_ready: channelId > 0,
      has_channel_identifier: Boolean(identifier),
      query_length_bucket: textLengthBucket(query),
      debounced_query_length_bucket: textLengthBucket(debouncedQuery),
    }),
    [channelId, debouncedQuery, identifier, query]
  );

  useEffect(() => {
    const eventKey = `${identifier}:${channelId || "pending"}`;
    if (quickViewedEventKeyRef.current === eventKey) return;
    quickViewedEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_quick_add_viewed", {
      ...baseProperties,
      channel_recommendation_count:
        channelRecs?.recommendations.length ?? null,
      channel_recommendation_count_bucket: countBucket(
        channelRecs?.recommendations.length
      ),
    });
  }, [baseProperties, channelId, channelRecs?.recommendations.length, identifier]);

  useEffect(() => {
    const normalizedQuery = debouncedQuery.trim();
    if (normalizedQuery.length < 2 || !matchData || isLoading) return;

    const summary = getQuickSearchSummary(matchData.results, normalizedQuery);
    const eventKey = [
      normalizedQuery,
      matchData.results.length,
      summary.already_in_channel_count,
      summary.high_confidence_count,
    ].join(":");
    if (searchResultEventKeyRef.current === eventKey) return;
    searchResultEventKeyRef.current = eventKey;

    captureIntentEvent(
      matchData.results.length > 0
        ? "channel_songbook_quick_search_results_loaded"
        : "channel_songbook_quick_search_empty_result_viewed",
      {
        ...baseProperties,
        ...summary,
      }
    );
  }, [baseProperties, debouncedQuery, isLoading, matchData]);

  useEffect(() => {
    if (postAddRecs.length === 0) return;
    const eventKey = postAddRecs.map((rec) => rec.globalSongId).join(",");
    if (postAddRecommendationEventKeyRef.current === eventKey) return;
    postAddRecommendationEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_quick_post_add_recommendations_viewed", {
      ...baseProperties,
      recommendation_source: "post_add_recommendation",
      recommendation_count: postAddRecs.length,
      recommendation_count_bucket: countBucket(postAddRecs.length),
      recommendation_with_album_art_count: postAddRecs.filter((rec) =>
        Boolean(rec.albumArt)
      ).length,
    });
  }, [baseProperties, postAddRecs]);

  useEffect(() => {
    const recommendations = channelRecs?.recommendations ?? [];
    if (debouncedQuery || recommendations.length === 0) return;
    const eventKey = recommendations.map((rec) => rec.globalSongId).join(",");
    if (channelRecommendationEventKeyRef.current === eventKey) return;
    channelRecommendationEventKeyRef.current = eventKey;
    captureIntentEvent("channel_songbook_quick_channel_recommendations_viewed", {
      ...baseProperties,
      recommendation_source: "channel_recommendation",
      recommendation_count: recommendations.length,
      recommendation_count_bucket: countBucket(recommendations.length),
      recommendation_with_album_art_count: recommendations.filter((rec) =>
        Boolean(rec.albumArt)
      ).length,
    });
  }, [baseProperties, channelRecs?.recommendations, debouncedQuery]);

  const handleQueryChange = (nextQuery: string) => {
    const wasEmpty = query.trim().length === 0;
    const isEmpty = nextQuery.trim().length === 0;
    setQuery(nextQuery);

    if (!queryStartedRef.current && !isEmpty) {
      queryStartedRef.current = true;
      captureIntentEvent("channel_songbook_quick_search_started", {
        ...baseProperties,
        query_length_bucket: textLengthBucket(nextQuery),
      });
    }

    if (!wasEmpty && isEmpty) {
      captureIntentEvent("channel_songbook_quick_search_cleared", {
        ...baseProperties,
        previous_query_length_bucket: textLengthBucket(query),
      });
    }
  };

  const handleQueryFocus = () => {
    if (queryFocusedRef.current) return;
    queryFocusedRef.current = true;
    captureIntentEvent("channel_songbook_quick_search_focused", {
      ...baseProperties,
    });
  };

  const handleQuickAdd = useCallback(
    async (result: MatchResult) => {
      const eventProperties = {
        ...baseProperties,
        ...getQuickMatchSummary(result, "search_result"),
        current_result_count: matchData?.results.length ?? null,
        current_result_count_bucket: countBucket(matchData?.results.length),
      };

      captureIntentEvent("channel_songbook_quick_search_result_add_clicked", {
        ...eventProperties,
      });

      if (!channelId) {
        captureIntentEvent(
          "channel_songbook_quick_search_result_add_blocked_channel_unready",
          eventProperties
        );
        return;
      }

      const categoryNames =
        result.topCategories.length > 0 ? result.topCategories : undefined;

      try {
        captureIntentEvent("channel_songbook_quick_search_result_add_submitted", {
          ...eventProperties,
          category_prefill_count: categoryNames?.length ?? 0,
          category_prefill_count_bucket: countBucket(categoryNames?.length ?? 0),
        });
        const response: QuickAddResponse = await quickAddMutation.mutateAsync({
          globalSongId: result.globalSongId,
          categoryNames,
        });
        toast.success(`"${result.title}" 추가 완료!`);
        captureIntentEvent("channel_songbook_quick_search_result_add_succeeded", {
          ...eventProperties,
          response_recommendation_count: response.recommendations?.length ?? 0,
          response_recommendation_count_bucket: countBucket(
            response.recommendations?.length ?? 0
          ),
        });
        // Show post-add recommendations if any
        if (response.recommendations?.length > 0) {
          captureIntentEvent(
            "channel_songbook_quick_search_result_post_recommendations_loaded",
            {
              ...eventProperties,
              response_recommendation_count: response.recommendations.length,
              response_recommendation_count_bucket: countBucket(
                response.recommendations.length
              ),
            }
          );
          setPostAddRecs(response.recommendations);
        }
      } catch (error: unknown) {
        const status = getApiErrorStatus(error);
        if (status === 409) {
          captureIntentEvent(
            "channel_songbook_quick_search_result_add_duplicate",
            {
              ...eventProperties,
              error_status: status,
            }
          );
          toast.error("이미 등록된 곡입니다.");
        } else {
          captureIntentEvent("channel_songbook_quick_search_result_add_failed", {
            ...eventProperties,
            error_status: status,
            error_name: getErrorName(error),
          });
          toast.error("추가에 실패했습니다. 다시 시도해주세요.");
        }
      }
    },
    [baseProperties, channelId, matchData?.results.length, quickAddMutation],
  );

  const handleAddFromRec = useCallback(
    async (
      rec: RecommendationItem,
      source: "post_add_recommendation" | "channel_recommendation"
    ) => {
      const eventProperties = {
        ...baseProperties,
        ...getRecommendationSummary(rec, source),
      };
      captureIntentEvent("channel_songbook_quick_recommendation_add_clicked", {
        ...eventProperties,
      });

      if (!channelId) {
        captureIntentEvent(
          "channel_songbook_quick_recommendation_add_blocked_channel_unready",
          eventProperties
        );
        return;
      }
      const categoryNames =
        rec.topCategories.length > 0 ? rec.topCategories : undefined;
      try {
        captureIntentEvent("channel_songbook_quick_recommendation_add_submitted", {
          ...eventProperties,
          category_prefill_count: categoryNames?.length ?? 0,
          category_prefill_count_bucket: countBucket(categoryNames?.length ?? 0),
        });
        const response: QuickAddResponse = await quickAddMutation.mutateAsync({
          globalSongId: rec.globalSongId,
          categoryNames,
        });
        toast.success(`"${rec.title}" 추가 완료!`);
        captureIntentEvent("channel_songbook_quick_recommendation_add_succeeded", {
          ...eventProperties,
          response_recommendation_count: response.recommendations?.length ?? 0,
          response_recommendation_count_bucket: countBucket(
            response.recommendations?.length ?? 0
          ),
        });
        if (response.recommendations?.length > 0) {
          captureIntentEvent(
            "channel_songbook_quick_recommendation_post_recommendations_loaded",
            {
              ...eventProperties,
              response_recommendation_count: response.recommendations.length,
              response_recommendation_count_bucket: countBucket(
                response.recommendations.length
              ),
            }
          );
          setPostAddRecs(response.recommendations);
        }
      } catch (error: unknown) {
        const status = getApiErrorStatus(error);
        if (status === 409) {
          captureIntentEvent("channel_songbook_quick_recommendation_add_duplicate", {
            ...eventProperties,
            error_status: status,
          });
          toast.error("이미 등록된 곡입니다.");
        } else {
          captureIntentEvent("channel_songbook_quick_recommendation_add_failed", {
            ...eventProperties,
            error_status: status,
            error_name: getErrorName(error),
          });
          toast.error("추가에 실패했습니다.");
        }
      }
    },
    [baseProperties, channelId, quickAddMutation],
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="노래 제목, 아티스트를 입력하세요 (예: 아이유 - 밤편지)"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={handleQueryFocus}
          className="pl-10"
        />
      </div>

      {isLoading && debouncedQuery.length >= 2 && (
        <div className="text-sm text-muted-foreground py-4 text-center">
          검색 중...
        </div>
      )}

      {matchData && matchData.results.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            검색 결과 ({matchData.results.length}건)
          </p>
          {matchData.results.map((result) => (
            <MatchResultCard
              key={result.globalSongId}
              result={result}
              onAdd={handleQuickAdd}
              isAdding={quickAddMutation.isPending}
            />
          ))}
        </div>
      )}

      {matchData && matchData.results.length === 0 && debouncedQuery.length >= 2 && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          <p>검색 결과가 없습니다.</p>
          <p className="mt-1">
            찾는 곡이 없나요?{" "}
            <button
              onClick={() => {
                captureIntentEvent(
                  "channel_songbook_quick_manual_fallback_clicked",
                  {
                    ...baseProperties,
                    ...getQuickSearchSummary(matchData.results, debouncedQuery),
                  }
                );
                const tabUrl = window.location.href.replace(
                  /tab=[^&]*/,
                  "tab=manual",
                );
                window.location.href = tabUrl;
              }}
              className="text-primary underline"
            >
              직접 입력하기 →
            </button>
          </p>
        </div>
      )}

      {/* Post-add recommendations */}
      {postAddRecs.length > 0 && (
        <RecommendationSection
          title="이 곡은 어떠세요?"
          items={postAddRecs}
          onAdd={(rec) =>
            handleAddFromRec(rec, "post_add_recommendation")
          }
          isAdding={quickAddMutation.isPending}
        />
      )}

      {/* Channel-wide recommendations (from CF cache) */}
      {!debouncedQuery &&
        channelRecs &&
        channelRecs.recommendations.length > 0 && (
          <RecommendationSection
            title="내 노래책에 추천하는 곡"
            items={channelRecs.recommendations}
            onAdd={(rec) =>
              handleAddFromRec(rec, "channel_recommendation")
            }
            isAdding={quickAddMutation.isPending}
          />
        )}
    </div>
  );
}

// ---------- Sub-components ----------

function MatchResultCard({
  result,
  onAdd,
  isAdding,
}: {
  result: MatchResult;
  onAdd: (result: MatchResult) => void;
  isAdding: boolean;
}) {
  if (result.alreadyInChannel) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/50 opacity-60">
        <div className="flex-shrink-0 size-10 rounded bg-muted flex items-center justify-center">
          <Check className="size-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {result.title} — {result.artist}
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertCircle className="size-3" />
            내 노래책에 이미 있습니다
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors">
      <div className="flex-shrink-0 size-10 rounded bg-muted flex items-center justify-center overflow-hidden">
        {result.albumArt ? (
          <img
            src={result.albumArt}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <Music className="size-4 text-muted-foreground" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {result.title} — {result.artist}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{result.channelCount}개 채널 보유</span>
          <span>·</span>
          <ConfidenceBadge confidence={result.matchConfidence} />
          {result.topCategories.length > 0 && (
            <>
              <span>·</span>
              <span className="truncate">
                {result.topCategories.slice(0, 3).join(", ")}
              </span>
            </>
          )}
        </div>
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={() => onAdd(result)}
        disabled={isAdding}
        className="flex-shrink-0"
      >
        <Plus className="size-3 mr-1" />
        추가
      </Button>
    </div>
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: "HIGH" | "MEDIUM" | "LOW";
}) {
  const variants: Record<string, "default" | "secondary" | "outline"> = {
    HIGH: "default",
    MEDIUM: "secondary",
    LOW: "outline",
  };
  return (
    <Badge variant={variants[confidence]} className="text-[10px] px-1 py-0">
      {confidence}
    </Badge>
  );
}

function RecommendationSection({
  title,
  items,
  onAdd,
  isAdding,
}: {
  title: string;
  items: RecommendationItem[];
  onAdd: (rec: RecommendationItem) => void;
  isAdding: boolean;
}) {
  return (
    <div className="space-y-2 pt-4 border-t">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-amber-500" />
        <p className="text-sm font-medium">{title}</p>
      </div>
      {items.map((rec) => (
        <div
          key={rec.globalSongId}
          className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors"
        >
          <div className="flex-shrink-0 size-10 rounded bg-muted flex items-center justify-center overflow-hidden">
            {rec.albumArt ? (
              <img
                src={rec.albumArt}
                alt=""
                className="size-full object-cover"
              />
            ) : (
              <Music className="size-4 text-muted-foreground" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {rec.title} — {rec.artist}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{rec.channelCount}개 채널 보유</span>
              {rec.topCategories.length > 0 && (
                <>
                  <span>·</span>
                  <span className="truncate">
                    {rec.topCategories.slice(0, 3).join(", ")}
                  </span>
                </>
              )}
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => onAdd(rec)}
            disabled={isAdding}
            className="flex-shrink-0"
          >
            <Plus className="size-3 mr-1" />
            추가
          </Button>
        </div>
      ))}
    </div>
  );
}
