import { list, record, string } from './contract';

export interface ReactionSummary { counts: { emoji: string; count: number }[]; mine: string | null }
export interface ReactionState { version: string; phase: 'loading' | 'ready' | 'error'; summary?: ReactionSummary; error?: string }
export function reactionSummary(value: unknown): ReactionSummary {
  const data = record(value);
  const seen = new Set<string>();
  const counts = list(data.counts).map(value => {
    const row = record(value); const emoji = string(row.emoji);
    if (emoji.length > 64 || seen.has(emoji) || !Number.isSafeInteger(row.count) || Number(row.count) < 1) throw new Error('INVALID_REACTIONS');
    seen.add(emoji);
    return { emoji, count: Number(row.count) };
  });
  const mine = data.mine === null ? null : string(data.mine);
  if (mine !== null && !seen.has(mine)) throw new Error('INVALID_REACTIONS');
  return { counts, mine };
}
