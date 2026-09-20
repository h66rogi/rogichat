import type { PushApi } from './api';
import { forgetBinding, readAccountBinding, readBinding, rememberBinding, subscriptionFingerprint } from './binding';
import type { BindingStorage, StoredBinding } from './binding';
import type { BrowserSubscription, PushBrowser, PushPermission, PushSupport } from './browser';
import type { PushCapabilitiesAvailable, PushSubscriptionIdentity } from './contract';
import { PushError, PushScopeChanged } from './errors';
import type { PushScope } from './scope';

/**
 * Web Push enrollment lifecycle for one account/session scope.
 *
 * The state is what the browser and the server actually reported. There is no optimistic
 * "on": the toggle reads enabled only while the account preference is on and this browser
 * session still holds the exact subscription it registered, with the permission still granted
 * and the capability still available. Every failure keeps the real
 * state and carries a reason, and turning notifications off stays possible whenever there is
 * state left to clear.
 *
 * Server enrollment capability is not delivery. A registered subscription means the server
 * may enqueue a wake for this browser; it proves nothing about the push service, the device
 * or whether a notification was shown.
 */
export interface PushEnrollmentState {
  support: PushSupport;
  permission: PushPermission;
  /** Server enrollment capability; null until read in this scope. */
  serverAvailable: boolean | null;
  /** The server's current application server key, or null when it is unavailable/unread. */
  applicationServerKey: string | null;
  /** Stored account preference; null until read in this scope. */
  preferenceEnabled: boolean | null;
  preferenceGeneration: string | null;
  /**
   * The subscription this browser session is actually enrolled with: registered by this very
   * session, and matching the exact subscription that registration was made for, endpoint,
   * subscription keys and application server key together. A record from another session, a
   * missing or replaced browser subscription, a rotated key or a record that cannot prove
   * which subscription it belongs to is not an enrollment and leaves this null.
   */
  subscriptionId: string | null;
  /** A local record exists for this account, so there is stored state left to clear. */
  ownsBinding: boolean;
  busy: boolean;
  /** User-facing result of the last action; empty when there is nothing to say. */
  notice: string;
  /** A compare-and-set conflict happened: re-read state and take a fresh user decision. */
  needsDecision: boolean;
}

const INITIAL: PushEnrollmentState = {
  support: 'unknown',
  permission: 'unknown',
  serverAvailable: null,
  applicationServerKey: null,
  preferenceEnabled: null,
  preferenceGeneration: null,
  subscriptionId: null,
  ownsBinding: false,
  busy: false,
  notice: '',
  needsDecision: false,
};

/**
 * Presentation model for the notification settings section.
 *
 * It is structurally the settings screen's own notification model, declared here so this
 * feature does not depend on the settings feature. The settings wiring assigns it directly,
 * so any drift in either shape is a typecheck failure at the wiring site.
 */
export interface PushNotificationsModel {
  support: PushSupport;
  permission: PushPermission;
  enabled: boolean | null;
  toggle: { enabled: true } | { enabled: false; reason: string };
}

export interface PushEnrollmentOptions {
  api: PushApi;
  browser: PushBrowser;
  storage: BindingStorage;
  scope: PushScope;
}

export class PushEnrollment {
  private readonly api: PushApi;
  private readonly browser: PushBrowser;
  private readonly storage: BindingStorage;
  private readonly scope: PushScope;
  private readonly listeners = new Set<() => void>();
  private state: PushEnrollmentState = INITIAL;

  constructor({ api, browser, storage, scope }: PushEnrollmentOptions) {
    this.api = api;
    this.browser = browser;
    this.storage = storage;
    this.scope = scope;
  }

  /** Stable snapshot; the reference changes only when the state changes. */
  getState = (): PushEnrollmentState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Reads current browser and server state. Never prompts and never changes stored state. */
  async refresh(): Promise<void> {
    await this.perform(async () => {
      this.set({ support: this.browser.support(), permission: this.browser.permission(), needsDecision: false, notice: '' });
      const capabilities = await this.scope.run(signal => this.api.capabilities(signal));
      this.set({ serverAvailable: capabilities.available, applicationServerKey: capabilities.available ? capabilities.applicationServerKey : null });
      const preferences = await this.scope.run(signal => this.api.preferences(signal));
      this.set({ preferenceEnabled: preferences.pushEnabled, preferenceGeneration: preferences.generation });
      await this.releaseForeignBinding();
      await this.reconcileSubscription();
    });
  }

  /**
   * Enrolls this browser. Call only from an explicit user gesture: it is the sole path that
   * asks for the notification permission.
   *
   * The permission prompt is started before the first `await`, inside the click's transient
   * activation: a browser rejects a request made after that activation expires, and two HTTP
   * round trips are long enough to lose it. Everything the decision to prompt needs — browser
   * support and the server's enrollment capability — was already read by `refresh`, and the
   * toggle stays blocked until it is known, so this never prompts for a capability the server
   * has not confirmed.
   *
   * The capability is then read again for the current application server key, the subscription
   * is registered, and only then is the account preference switched on, so the preference the
   * server holds is never true while it has no endpoint for this browser.
   */
  async enable(): Promise<void> {
    await this.perform(async () => {
      const support = this.browser.support();
      const permission = this.browser.permission();
      this.set({ support, permission, needsDecision: false, notice: '' });
      if (support !== 'supported') {
        this.set({ notice: supportNotice(support) });
        return;
      }
      if (this.state.serverAvailable !== true) {
        this.set({ notice: '서버의 웹 푸시 준비 상태를 확인한 뒤 다시 시도해 주세요.' });
        return;
      }
      if (permission === 'denied') {
        this.set({ notice: '브라우저에서 알림이 차단되어 있습니다. 브라우저 설정에서 허용한 뒤 다시 시도해 주세요.' });
        return;
      }

      // Started synchronously: nothing may be awaited before the prompt.
      const prompt = permission === 'granted' ? null : this.browser.requestPermission();
      if (prompt !== null) this.set({ permission: await this.scope.run(() => prompt) });
      if (this.state.permission !== 'granted') {
        this.set({ notice: '알림 권한을 허용해야 알림을 켤 수 있습니다.' });
        return;
      }

      // The prompt may have taken a while, and registration needs the server's current
      // application server key rather than the one read before the click.
      const capabilities = await this.scope.run(signal => this.api.capabilities(signal));
      this.set({ serverAvailable: capabilities.available, applicationServerKey: capabilities.available ? capabilities.applicationServerKey : null });
      if (!capabilities.available) {
        this.set({ notice: '서버에서 웹 푸시가 아직 준비되지 않아 알림을 켤 수 없습니다.' });
        return;
      }

      const preferences = await this.scope.run(signal => this.api.preferences(signal));
      this.set({ preferenceEnabled: preferences.pushEnabled, preferenceGeneration: preferences.generation });

      const identity = await this.registerSubscription(capabilities);
      if (identity === null) return;
      this.set({ subscriptionId: identity.id, ownsBinding: true });

      try {
        const stored = await this.scope.run(signal => this.api.setPreferences(true, preferences.generation, signal));
        this.set({ preferenceEnabled: stored.pushEnabled, preferenceGeneration: stored.generation, notice: '이 브라우저에서 새 메시지 알림을 받습니다. 알림에는 메시지 내용이 들어가지 않습니다.' });
      } catch (error) {
        await this.handlePreferenceFailure(error);
      }
    });
  }

  /**
   * Turns the account preference off, withdraws the server subscription this browser owns and
   * unsubscribes from the push service. Disabling stays available even when the server has no
   * Web Push configuration.
   */
  async disable(): Promise<void> {
    await this.perform(async () => {
      this.set({ support: this.browser.support(), permission: this.browser.permission(), needsDecision: false, notice: '' });
      const expected = this.state.preferenceGeneration ?? (await this.scope.run(signal => this.api.preferences(signal))).generation;
      let stopped = false;
      try {
        const stored = await this.scope.run(signal => this.api.setPreferences(false, expected, signal));
        this.set({ preferenceEnabled: stored.pushEnabled, preferenceGeneration: stored.generation });
        stopped = true;
      } catch (error) {
        await this.handlePreferenceFailure(error);
      }
      // The removal detail outranks the generic confirmation: a record this session could not
      // withdraw must be reported rather than described as a clean removal. A preference
      // failure outranks both, because the preference is what actually stops delivery.
      const detail = await this.releaseSubscription();
      if (stopped) this.set({ notice: detail ?? '이 브라우저에서 알림을 받지 않습니다.' });
    });
  }

  /**
   * What pressing the toggle does right now, or null when it can do nothing.
   *
   * This is not `!model().enabled`. A browser whose permission was withdrawn, whose key has
   * rotated or whose server lost its capability reports `enabled: false` while the server
   * still holds a subscription and a preference, and there the toggle means clean up, not
   * enrol. Deriving the action from the displayed value would send that press to `enable()`,
   * which refuses, and the user could never release what the server holds.
   */
  intent(): 'enable' | 'disable' | null {
    if (toggleBlock(this.state, this.model().enabled) !== null) return null;
    return this.state.preferenceEnabled === true || this.state.ownsBinding ? 'disable' : 'enable';
  }

  /**
   * Runs the action the toggle stands for. Call this directly from the click handler rather
   * than choosing between `enable` and `disable` from the displayed value: it dispatches
   * without awaiting first, so the permission prompt stays inside the click's activation.
   */
  toggle(): Promise<void> {
    const intent = this.intent();
    if (intent === 'enable') return this.enable();
    if (intent === 'disable') return this.disable();
    return Promise.resolve();
  }

  /**
   * Presentation model for the settings screen.
   *
   * `enabled` is true only when every condition a notification actually depends on holds at
   * once: the account preference is on, this browser session owns a live subscription created
   * with the server's current application server key, the browser still supports Web Push, the
   * permission is still granted and the server still reports the capability. A permission
   * revoked in browser settings, a rotated key or a server that lost its configuration all make
   * this false, because none of them can deliver anything.
   */
  model(): PushNotificationsModel {
    const state = this.state;
    const enabled = state.preferenceEnabled === null ? null : state.preferenceEnabled &&
      state.subscriptionId !== null && state.support === 'supported' && state.permission === 'granted' && state.serverAvailable === true;
    const reason = toggleBlock(state, enabled);
    return { support: state.support, permission: state.permission, enabled, toggle: reason === null ? { enabled: true } : { enabled: false, reason } };
  }

  // --- internals -------------------------------------------------------------------------

  /**
   * Obtains an endpoint and registers it, returning null when the state was already handled.
   *
   * A browser subscription created for a different application server key is rotated. An
   * endpoint the server refuses for this account (404) or that needs a generation we do not
   * hold (409) is withdrawn and replaced once by a fresh endpoint; if the push service hands
   * back the same endpoint, registration stays unavailable rather than pretending to succeed.
   */
  private async registerSubscription(capabilities: PushCapabilitiesAvailable): Promise<PushSubscriptionIdentity | null> {
    await this.releaseForeignBinding();
    let current = await this.scope.run(() => this.browser.current());
    if (current !== null && current.applicationServerKey !== null && current.applicationServerKey !== capabilities.applicationServerKey) {
      await this.scope.run(() => this.browser.unsubscribe());
      current = null;
    }

    const owned = readAccountBinding(this.storage, this.scope.identity);
    if (current === null) current = await this.scope.run(() => this.browser.subscribe(capabilities.applicationServerKey));

    try {
      return this.remember(await this.registerEndpoint(current, owned), current, capabilities.applicationServerKey);
    } catch (error) {
      if (!(error instanceof PushError) || !['not-found', 'conflict'].includes(error.kind)) throw error;
      // The endpoint belongs to another account or to a binding whose generation we do not
      // have. Only a genuinely new endpoint can be registered here.
      const previous = current.endpoint;
      forgetBinding(this.storage);
      await this.scope.run(() => this.browser.unsubscribe());
      const fresh = await this.scope.run(() => this.browser.subscribe(capabilities.applicationServerKey));
      if (fresh.endpoint === previous) {
        this.set({ subscriptionId: null, ownsBinding: false, notice: '브라우저가 이전과 같은 알림 주소를 다시 발급해 지금은 알림을 켤 수 없습니다. 브라우저의 사이트 알림 권한을 해제한 뒤 다시 시도해 주세요.' });
        return null;
      }
      return this.remember(await this.registerEndpoint(fresh, null), fresh, capabilities.applicationServerKey);
    }
  }

  /**
   * One registration attempt. A same-account session rebinding sends the current generation;
   * a new endpoint omits it. Only a lost response is retried, with the byte-identical initial
   * body, which the server answers with the existing id and generation without mutating it.
   */
  private async registerEndpoint(subscription: BrowserSubscription, owned: StoredBinding | null): Promise<PushSubscriptionIdentity> {
    const rebinding = owned !== null && owned.session !== this.scope.identity.session;
    const input = rebinding && owned !== null
      ? { endpoint: subscription.endpoint, keys: subscription.keys, generation: owned.generation }
      : { endpoint: subscription.endpoint, keys: subscription.keys };
    try {
      return await this.scope.run(signal => this.api.register(input, signal));
    } catch (error) {
      if (rebinding || !(error instanceof PushError) || error.kind !== 'network') throw error;
      return this.scope.run(signal => this.api.register(input, signal));
    }
  }

  /** Records the registration bound to the exact subscription it was made for. */
  private async remember(identity: PushSubscriptionIdentity, subscription: BrowserSubscription, applicationServerKey: string): Promise<PushSubscriptionIdentity> {
    const fingerprint = await this.scope.run(() => subscriptionFingerprint(subscription.endpoint, subscription.keys, applicationServerKey));
    rememberBinding(this.storage, this.scope.identity, { ...identity, fingerprint });
    return identity;
  }

  /**
   * Withdraws the subscription this browser owns, then unsubscribes from the push service.
   * Returns what the user has to know when the server record could not be withdrawn here,
   * or null when the removal was clean.
   */
  private async releaseSubscription(): Promise<string | null> {
    const owned = readAccountBinding(this.storage, this.scope.identity);
    let detail: string | null = null;
    if (owned !== null && owned.session === this.scope.identity.session) {
      try {
        await this.scope.run(signal => this.api.remove(owned.id, owned.generation, signal));
      } catch (error) {
        if (error instanceof PushScopeChanged) throw error;
        if (!(error instanceof PushError) || !['not-found', 'conflict'].includes(error.kind)) throw error;
        // The server record is already gone or now belongs to a newer binding of this browser.
        // The local record is stale either way; say so instead of reporting a clean removal.
        detail = '서버의 알림 등록 정보가 이미 변경되어 이 브라우저의 기록만 정리했습니다.';
      }
    } else if (owned !== null) {
      // Only the owning session may withdraw a subscription, so this one stops at the browser.
      detail = '다른 로그인 세션에서 등록한 알림입니다. 이 브라우저의 구독만 해제했습니다.';
    }
    forgetBinding(this.storage);
    await this.scope.run(() => this.browser.unsubscribe());
    this.set({ subscriptionId: null, ownsBinding: false });
    return detail;
  }

  /**
   * An account switch leaves a subscription bound to the previous account. The server never
   * transfers endpoint ownership, so the old endpoint is withdrawn in the browser and the
   * local record dropped before this account can enroll.
   */
  private async releaseForeignBinding(): Promise<void> {
    const stored = readBinding(this.storage);
    if (stored === null || stored.account === this.scope.identity.account) return;
    forgetBinding(this.storage);
    await this.scope.run(() => this.browser.unsubscribe());
  }

  /**
   * Decides what this browser session is really enrolled with.
   *
   * A record for this account proves there is state to clear, which keeps the disable path
   * available, but it is an enrollment only when this very session registered it and the
   * browser still holds a live subscription for the server's current application server key.
   * A record from an earlier session, a subscription the browser has dropped, or one created
   * with a key that has since rotated cannot receive anything and is never shown as enrolled.
   */
  private async reconcileSubscription(): Promise<void> {
    const owned = readAccountBinding(this.storage, this.scope.identity);
    this.set({ ownsBinding: owned !== null });
    if (owned === null || owned.session !== this.scope.identity.session) {
      this.set({ subscriptionId: null });
      return;
    }
    const current = await this.scope.run(() => this.browser.current());
    this.set({ subscriptionId: current !== null && await this.isRegisteredSubscription(current, owned) ? owned.id : null });
  }

  /**
   * Whether the subscription the browser holds now is the one this record was written for.
   *
   * The fingerprint covers the endpoint, the subscription keys and the application server key
   * together, so a replaced endpoint under the same key, a rotated key and a subscription made
   * before either all fail to match. A record without a fingerprint proves nothing about the
   * current subscription, so it is not a match either: the server binding may belong to an
   * endpoint this browser no longer has, and presenting that as enrolled would claim a
   * delivery path that does not exist.
   */
  private async isRegisteredSubscription(subscription: BrowserSubscription, owned: StoredBinding): Promise<boolean> {
    const live = this.state.applicationServerKey;
    if (live === null || owned.fingerprint === null) return false;
    // A browser that names its subscription's key must name the server's current one.
    if (subscription.applicationServerKey !== null && subscription.applicationServerKey !== live) return false;
    const fingerprint = await this.scope.run(() => subscriptionFingerprint(subscription.endpoint, subscription.keys, live));
    return fingerprint === owned.fingerprint;
  }

  private async handlePreferenceFailure(error: unknown): Promise<void> {
    if (error instanceof PushScopeChanged) throw error;
    if (!(error instanceof PushError) || error.kind !== 'conflict') throw error;
    // A stale generation must never be replayed: read the stored value and ask again.
    const current = await this.scope.run(signal => this.api.preferences(signal));
    this.set({
      preferenceEnabled: current.pushEnabled,
      preferenceGeneration: current.generation,
      needsDecision: true,
      notice: '알림 설정이 다른 곳에서 변경되었습니다. 현재 설정을 확인한 뒤 다시 선택해 주세요.',
    });
  }

  private async perform(operation: () => Promise<void>): Promise<void> {
    if (this.state.busy || !this.scope.active) return;
    this.set({ busy: true });
    try {
      await operation();
    } catch (error) {
      if (error instanceof PushScopeChanged) return;
      this.set({ notice: error instanceof PushError ? error.message : '알림 설정을 확인하지 못했습니다. 다시 시도해 주세요.' });
    } finally {
      if (this.scope.active) this.set({ busy: false });
    }
  }

  private set(patch: Partial<PushEnrollmentState>): void {
    if (!this.scope.active) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

function supportNotice(support: PushSupport): string {
  switch (support) {
    case 'install-required': return '홈 화면에 로기챗을 추가한 뒤 알림을 켤 수 있습니다.';
    case 'unsupported': return '이 브라우저는 웹 알림을 지원하지 않습니다.';
    default: return '브라우저의 알림 지원 여부를 확인하지 못했습니다.';
  }
}

function toggleBlock(state: PushEnrollmentState, enabled: boolean | null): string | null {
  if (state.busy) return '알림 설정을 변경하고 있습니다.';
  if (enabled === null) return '알림 설정을 확인하는 중입니다.';
  // Turning notifications off must stay available while any state remains to clear, including
  // when the permission was withdrawn, the key rotated or the server lost its configuration.
  // Without this the user could never release a subscription the server still holds.
  if (state.preferenceEnabled === true || state.ownsBinding) return null;
  if (state.support !== 'supported') return supportNotice(state.support);
  if (state.permission === 'denied') return '브라우저에서 알림이 차단되어 있습니다. 브라우저 설정에서 허용해 주세요.';
  if (state.serverAvailable === false) return '서버에서 웹 푸시가 아직 준비되지 않았습니다.';
  // Enabling needs a confirmed capability; the toggle waits rather than prompting blindly.
  if (state.serverAvailable === null) return '알림 설정을 확인하는 중입니다.';
  return null;
}
