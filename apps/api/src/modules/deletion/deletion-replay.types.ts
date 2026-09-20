import type { LedgerEnvironment } from './deletion-ledger.js';

export interface ReplaySource { sourceId: string; environment: LedgerEnvironment }
export interface DiscoveryClaim extends ReplaySource {
  token: string; epoch: bigint; generation: bigint; cursor: string | null;
}
export interface ReplayClaim extends ReplaySource {
  keySha256: string; key: string; token: string; epoch: bigint; phase: 'APPLY' | 'SCRUB';
}
export type ReplayFailure = 'UNAVAILABLE' | 'INVALID_RECEIPT' | 'RECEIPT_CONFLICT' | 'APPLY_FAILED' | 'SCRUB_FAILED' | 'INVENTORY_INVALID';
export class ReplayFenceError extends Error {
  constructor() { super('deletion_replay_fence_lost'); }
}
export interface ReplayCounts {
  discovered: number; invalid: number; attempted: number; applied: number; pending: number; failed: number;
  inventoryPassEnded: boolean; discoveryFailed: boolean;
}
