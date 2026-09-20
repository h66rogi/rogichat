import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transactions.js';
import type { LedgerDiscoveryItem } from './deletion-ledger.js';
import { ReplayFenceError } from './deletion-replay.types.js';
import type { DiscoveryClaim, ReplayClaim, ReplayFailure, ReplaySource } from './deletion-replay.types.js';

const LEASE_MS = 60000;
const RETRY_MS = 5000;
interface SourceRow {
  environment: string; cursor: string | null; generation: string; discovery_token: string | null;
  discovery_epoch: string; discovery_until: Date | null; next_lane: string; first_failure_at: Date | null;
}
interface EntryRow {
  key_sha256: string; object_key: string | null; classification: string; phase: string; state: string;
  evidence_conflict: boolean | number; receipt_sha256: string | null; discovered_generation: string;
  claim_token: string | null; claim_epoch: string; claim_until: Date | null; first_failure_at: Date | null;
}

/** Private persistence. Caller owns every transaction; no external I/O or content here. */
@Injectable()
export class DeletionReplayRepository {
  private async source(tx: Transaction, source: ReplaySource): Promise<SourceRow> {
    await tx.prisma.deletion_replay_sources.createMany({ data: [{ source_id: source.sourceId, environment: source.environment }], skipDuplicates: true });
    const [row] = await tx.rows<SourceRow>(
      'SELECT environment,`cursor`,generation,discovery_token,discovery_epoch,discovery_until,next_lane,first_failure_at FROM deletion_replay_sources WHERE source_id=? FOR UPDATE', [source.sourceId]);
    if (!row || row.environment !== source.environment) throw new ReplayFenceError();
    return row;
  }
  async claimDiscovery(tx: Transaction, source: ReplaySource): Promise<DiscoveryClaim | null> {
    const row = await this.source(tx, source), now = await tx.now();
    if (row.discovery_until && row.discovery_until > now) return null;
    const token = randomUUID(), epoch = BigInt(row.discovery_epoch) + 1n;
    await tx.prisma.deletion_replay_sources.update({ where: { source_id: source.sourceId }, data: {
      discovery_token: token, discovery_epoch: epoch, discovery_until: new Date(now.getTime() + LEASE_MS),
    }, select: { source_id: true } });
    return { ...source, token, epoch, generation: BigInt(row.generation), cursor: row.cursor };
  }
  private async discoveryFence(tx: Transaction, claim: DiscoveryClaim) {
    const row = await this.source(tx, claim), now = await tx.now();
    if (row.discovery_token !== claim.token || BigInt(row.discovery_epoch) !== claim.epoch ||
        !row.discovery_until || row.discovery_until <= now || BigInt(row.generation) !== claim.generation || row.cursor !== claim.cursor) throw new ReplayFenceError();
    return { row, now };
  }
  private async entry(tx: Transaction, sourceId: string, keySha256: string): Promise<EntryRow> {
    const [row] = await tx.rows<EntryRow>(
      'SELECT key_sha256,object_key,classification,phase,state,evidence_conflict,receipt_sha256,discovered_generation,claim_token,claim_epoch,claim_until,first_failure_at FROM deletion_replay_entries WHERE source_id=? AND key_sha256=? FOR UPDATE', [sourceId, keySha256]);
    if (!row) throw new ReplayFenceError();
    return row;
  }
  private where(sourceId: string, keySha256: string) { return { source_id_key_sha256: { source_id: sourceId, key_sha256: keySha256 } }; }
  async registerPage(tx: Transaction, claim: DiscoveryClaim, page: { items: LedgerDiscoveryItem[]; cursor: string | null }) {
    if (page.items.length > 50) throw new Error('deletion_replay_page_bound');
    const { now } = await this.discoveryFence(tx, claim);
    let invalid = 0;
    for (const item of page.items) {
      if (item.classification !== 'VALID') invalid++;
      await tx.prisma.deletion_replay_entries.createMany({ data: [{ source_id: claim.sourceId, key_sha256: item.keySha256,
        object_key: item.key, classification: item.classification, state: item.classification === 'VALID' ? 'READY' : 'INVALID',
        discovered_generation: claim.generation, next_attempt_at: now,
        ...(item.classification === 'VALID' ? {} : { first_failure_at: now, last_failure_at: now, last_failure_code: item.classification }),
      }], skipDuplicates: true });
      const row = await this.entry(tx, claim.sourceId, item.keySha256);
      const where = this.where(claim.sourceId, item.keySha256);
      if (row.object_key !== item.key || row.classification !== item.classification) {
        if (item.classification === 'VALID') invalid++;
        // Preserve the original immutable evidence, active claim and phase. No repair-by-overwrite.
        await tx.prisma.deletion_replay_entries.update({ where, data: { evidence_conflict: true,
          first_failure_at: row.first_failure_at ?? now, last_failure_at: now, last_failure_code: 'DISCOVERY_CONFLICT',
        }, select: { key_sha256: true } });
        continue;
      }
      const newer = claim.generation > BigInt(row.discovered_generation);
      const reobserve = newer && row.state === 'OBSERVED' && !row.evidence_conflict && !row.claim_token;
      await tx.prisma.deletion_replay_entries.update({ where, data: {
        ...(newer ? { discovered_generation: claim.generation } : {}),
        ...(reobserve ? { state: 'RETRY', phase: 'APPLY', next_attempt_at: now } : {}),
      }, select: { key_sha256: true } });
    }
    // Lease can expire while acquiring one of the entry locks: recheck after all waits.
    await this.discoveryFence(tx, claim);
    await tx.prisma.deletion_replay_sources.update({ where: { source_id: claim.sourceId }, data: {
      cursor: page.cursor, ...(page.cursor === null ? { generation: { increment: 1n } } : {}),
      discovery_token: null, discovery_until: null, current_failure_code: null,
    }, select: { source_id: true } });
    return { invalid };
  }
  async failDiscovery(tx: Transaction, claim: DiscoveryClaim, code: ReplayFailure) {
    const { row, now } = await this.discoveryFence(tx, claim);
    await tx.prisma.deletion_replay_sources.update({ where: { source_id: claim.sourceId }, data: {
      current_failure_code: code, last_failure_code: code, first_failure_at: row.first_failure_at ?? now, last_failure_at: now,
      discovery_token: null, discovery_until: null,
    }, select: { source_id: true } });
  }
  async claimEntry(tx: Transaction, source: ReplaySource): Promise<ReplayClaim | null> {
    const row = await this.source(tx, source);
    for (const lane of [row.next_lane, row.next_lane === 'NEW' ? 'RETRY' : 'NEW']) {
      const now = await tx.now(), retry = lane === 'RETRY' ? 1 : 0;
      const [candidate] = await tx.rows<{ key_sha256: string }>(
        "SELECT key_sha256 FROM deletion_replay_entries WHERE source_id=? AND classification='VALID' AND evidence_conflict=FALSE AND state IN ('READY','RETRY') AND next_attempt_at<=? AND (claim_until IS NULL OR claim_until<=?) AND ((?=0 AND attempt_count=0) OR (?=1 AND attempt_count>0)) ORDER BY next_attempt_at,key_sha256 LIMIT 1 FOR UPDATE SKIP LOCKED",
        [source.sourceId, now, now, retry, retry]);
      if (!candidate) continue;
      const entry = await this.entry(tx, source.sourceId, candidate.key_sha256), fresh = await tx.now();
      if (!entry.object_key || entry.evidence_conflict || (entry.claim_until && entry.claim_until > fresh)) throw new ReplayFenceError();
      const token = randomUUID(), epoch = BigInt(entry.claim_epoch) + 1n;
      if (entry.phase !== 'APPLY' && entry.phase !== 'SCRUB') throw new ReplayFenceError();
      await tx.prisma.deletion_replay_entries.update({ where: this.where(source.sourceId, candidate.key_sha256), data: {
        claim_token: token, claim_epoch: epoch, claim_until: new Date(fresh.getTime() + LEASE_MS),
        attempt_count: { increment: 1n },
      }, select: { key_sha256: true } });
      await tx.prisma.deletion_replay_sources.update({ where: { source_id: source.sourceId }, data: {
        next_lane: lane === 'NEW' ? 'RETRY' : 'NEW',
      }, select: { source_id: true } });
      return { ...source, keySha256: candidate.key_sha256, key: entry.object_key, token, epoch, phase: entry.phase };
    }
    return null;
  }
  async fence(tx: Transaction, claim: ReplayClaim, digest?: string) {
    const row = await this.entry(tx, claim.sourceId, claim.keySha256), now = await tx.now();
    if (row.claim_token !== claim.token || BigInt(row.claim_epoch) !== claim.epoch || !row.claim_until || row.claim_until <= now ||
        row.object_key !== claim.key || row.phase !== claim.phase || row.classification !== 'VALID' || row.evidence_conflict) throw new ReplayFenceError();
    if (digest && row.receipt_sha256 && row.receipt_sha256 !== digest) throw new Error('deletion_replay_receipt_conflict');
    return { row, now };
  }
  async pinReceipt(tx: Transaction, claim: ReplayClaim, digest: string) {
    await this.fence(tx, claim, digest);
    await tx.prisma.deletion_replay_entries.update({ where: this.where(claim.sourceId, claim.keySha256),
      data: { receipt_sha256: digest }, select: { key_sha256: true } });
  }
  async finish(tx: Transaction, claim: ReplayClaim, digest: string, status: 'observed' | 'pending' | 'scrub' | 'reapply') {
    const { row, now } = await this.fence(tx, claim, digest);
    await tx.prisma.deletion_replay_entries.update({ where: this.where(claim.sourceId, claim.keySha256), data: {
      receipt_sha256: digest, state: status === 'observed' ? 'OBSERVED' : 'RETRY', phase: status === 'reapply' ? 'APPLY' : status === 'scrub' ? 'SCRUB' : claim.phase,
      ...(status === 'observed' ? { processed_generation: BigInt(row.discovered_generation) } : {}),
      next_attempt_at: new Date(now.getTime() + RETRY_MS), claim_token: null, claim_until: null,
    }, select: { key_sha256: true } });
  }
  async failEntry(tx: Transaction, claim: ReplayClaim, code: ReplayFailure) {
    const { row, now } = await this.fence(tx, claim);
    await tx.prisma.deletion_replay_entries.update({ where: this.where(claim.sourceId, claim.keySha256), data: {
      state: ['INVALID_RECEIPT', 'RECEIPT_CONFLICT'].includes(code) ? 'INVALID' : 'RETRY', next_attempt_at: new Date(now.getTime() + RETRY_MS), first_failure_at: row.first_failure_at ?? now,
      last_failure_at: now, last_failure_code: code, claim_token: null, claim_until: null,
    }, select: { key_sha256: true } });
  }
}
