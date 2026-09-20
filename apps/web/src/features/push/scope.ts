import { PushScopeChanged } from './errors';

/**
 * Account and session lifetime fence.
 *
 * Enrollment spans several round trips and a permission prompt. If the account or session
 * changes in between, every in-flight step is aborted and its late completion is discarded,
 * so a subscription is never registered, removed or displayed under the wrong account.
 */
export interface PushScopeIdentity {
  /** Opaque, non-reversible identity of the signed-in account. Raw account ids are not stored. */
  account: string;
  /** Opaque, non-reversible identity of the current session, e.g. sessionBinding(csrfToken). */
  session: string;
}

export function sameIdentity(left: PushScopeIdentity, right: PushScopeIdentity): boolean {
  return left.account === right.account && left.session === right.session;
}

export class PushScope {
  readonly identity: PushScopeIdentity;
  private readonly controller = new AbortController();

  constructor(identity: PushScopeIdentity) {
    this.identity = identity;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get active(): boolean {
    return !this.controller.signal.aborted;
  }

  /** Ends the scope: pending requests abort and later completions are refused. */
  end(): void {
    this.controller.abort();
  }

  matches(identity: PushScopeIdentity): boolean {
    return sameIdentity(this.identity, identity);
  }

  /**
   * Runs one step under this scope. The operation receives the scope signal so it can stop
   * early, and a result that arrives after the scope ended is dropped instead of applied.
   */
  async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.active) throw new PushScopeChanged();
    let value: T;
    try {
      value = await operation(this.signal);
    } catch (error) {
      if (!this.active) throw new PushScopeChanged();
      throw error;
    }
    if (!this.active) throw new PushScopeChanged();
    return value;
  }
}

/**
 * Returns the scope to use for `identity`, ending the previous one when the account or session
 * changed. Callers keep a single current scope and never keep two live scopes for one browser.
 */
export function adoptScope(previous: PushScope | null, identity: PushScopeIdentity): PushScope {
  if (previous && previous.active && previous.matches(identity)) return previous;
  previous?.end();
  return new PushScope(identity);
}
