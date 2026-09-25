import type { Session } from '../../core/api/client';
import type { RoomMembership, ServerMessage } from '../chat/contract';
import type { PrivacyClient, PublicationReceipt } from './client';

export interface PublicationContext { session: Session; scope: RoomMembership; generation: number; message: ServerMessage }
export function canOfferPublication(context: PublicationContext): boolean {
  return context.scope.role === 'STREAMER' && context.message.audience === 'PRIVATE' && context.message.content.type === 'TEXT' && context.message.content.text !== null && context.message.allowedActions.publish === true;
}
export function publicationKey(context: PublicationContext): string {
  return JSON.stringify([context.session.accountPartition, context.session.csrfToken, context.generation, context.scope.roomId,
    context.scope.actorId, context.scope.membershipScope, context.scope.authorizationRevision, context.scope.role,
    context.message.id, context.message.version, canOfferPublication(context)]);
}
export type PublicationState = 'idle' | 'sending' | 'preparing' | 'published' | 'revoked' | 'unknown' | 'unavailable';
/** Memory-only pending ID. Reload/DTO/context changes discard linkage; never retry POST automatically. */
export class PublicationFlow {
  state: PublicationState = 'idle';
  private id: string | undefined;
  private active = new AbortController();
  private busy = false;
  private disposed = false;
  private readonly api: PrivacyClient;
  private readonly context: PublicationContext;
  private readonly changed: (state: PublicationState) => void;
  private readonly onPublished: () => void;
  constructor(api: PrivacyClient, context: PublicationContext, changed: (state: PublicationState) => void, onPublished: () => void) {
    this.api = api; this.context = context; this.changed = changed; this.onPublished = onPublished;
  }
  private set(state: PublicationState) { if (!this.disposed) { this.state = state; this.changed(state); } }
  dispose() { this.disposed = true; this.active.abort(); this.id = undefined; }
  get canCheck() { return !!this.id && !this.disposed && !['published', 'revoked'].includes(this.state); }
  private async verify(): Promise<boolean> {
    const current = await this.api.session(this.active.signal); this.active.signal.throwIfAborted();
    if (current.accountPartition !== this.context.session.accountPartition || current.csrfToken !== this.context.session.csrfToken) { this.id = undefined; this.set('unavailable'); return false; }
    return true;
  }
  private accept(receipt: PublicationReceipt) {
    this.active.signal.throwIfAborted(); this.id = receipt.publicationId; this.set(receipt.status);
    if (receipt.status === 'published') this.onPublished();
  }
  async publish(): Promise<void> {
    if (this.busy || this.disposed || this.state !== 'idle' || !canOfferPublication(this.context)) return;
    this.busy = true; this.set('sending');
    try {
      if (!await this.verify()) return;
      const receipt = await this.api.publish(this.context.scope.roomId, this.context.message.id, this.context.session.csrfToken, this.active.signal);
      this.active.signal.throwIfAborted();
      if (!await this.verify()) return;
      this.accept(receipt);
    } catch { this.set('unknown'); }
    finally { this.busy = false; }
  }
  async check(): Promise<void> {
    if (this.busy || !this.canCheck) return;
    this.busy = true;
    try {
      if (!await this.verify()) return;
      const receipt = await this.api.publication(this.context.scope.roomId, this.id!, this.active.signal);
      this.active.signal.throwIfAborted();
      if (!await this.verify()) return;
      this.accept(receipt);
    }
    catch { this.set('unknown'); }
    finally { this.busy = false; }
  }
}
