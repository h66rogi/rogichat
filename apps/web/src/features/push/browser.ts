import { fromBase64Url, isApplicationServerKey, isAuthSecret, isSubscriptionEndpoint, toBase64Url } from './contract';
import type { PushSubscriptionKeys } from './contract';
import { PushError } from './errors';

/**
 * The browser side of enrollment: service worker registration, the Push API and the
 * notification permission. It is a port so the lifecycle can be tested without a browser;
 * the production adapter below is the only implementation that ships in the app bundle.
 *
 * Permission is requested exclusively through `requestPermission`, which callers must invoke
 * from an explicit user gesture. Nothing here prompts on load, on navigation or on refresh.
 */
export type PushSupport = 'supported' | 'unsupported' | 'install-required' | 'unknown';
export type PushPermission = 'granted' | 'denied' | 'not-asked' | 'unknown';

export interface BrowserSubscription {
  endpoint: string;
  keys: PushSubscriptionKeys;
  /** Application server key this subscription was created with; null when the browser hides it. */
  applicationServerKey: string | null;
}

export interface PushBrowser {
  support(): PushSupport;
  permission(): PushPermission;
  /** Call only from a user gesture. */
  requestPermission(): Promise<PushPermission>;
  current(): Promise<BrowserSubscription | null>;
  subscribe(applicationServerKey: string): Promise<BrowserSubscription>;
  /** True when an existing subscription was withdrawn from the push service. */
  unsubscribe(): Promise<boolean>;
}

export function readPermission(value: NotificationPermission): PushPermission {
  switch (value) {
    case 'granted': return 'granted';
    case 'denied': return 'denied';
    default: return 'not-asked';
  }
}

/**
 * Converts a browser subscription into the exact fields the server accepts. A subscription
 * without both keys cannot be enrolled, so it fails here instead of producing a 400 later.
 */
export function describeSubscription(subscription: PushSubscription): BrowserSubscription {
  const endpoint = subscription.endpoint;
  const p256dh = encodeKey(subscription.getKey('p256dh'));
  const auth = encodeKey(subscription.getKey('auth'));
  if (!isSubscriptionEndpoint(endpoint) || !isApplicationServerKey(p256dh) || !isAuthSecret(auth)) throw new PushError('browser');
  return { endpoint, keys: { p256dh, auth }, applicationServerKey: encodeKey(subscription.options.applicationServerKey) };
}

function encodeKey(value: ArrayBuffer | null): string | null {
  return value === null ? null : toBase64Url(new Uint8Array(value));
}

function applePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function homeScreenApp(): boolean {
  if (typeof navigator !== 'undefined' && (navigator as { standalone?: unknown }).standalone === true) return true;
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

/**
 * Production adapter over the real browser APIs.
 *
 * `/sw.js` is served from the web origin (see next.config.ts headers). Registration happens
 * here rather than on page load so the worker is installed by the same user action that
 * enrolls, and never as a side effect of visiting the site.
 */
export class WebPushBrowser implements PushBrowser {
  private readonly scriptUrl: string;

  constructor(scriptUrl = '/sw.js') {
    this.scriptUrl = scriptUrl;
  }

  support(): PushSupport {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unknown';
    if ('serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined') return 'supported';
    // iOS and iPadOS expose Web Push only to a Home Screen web app; a Safari tab is not equivalent.
    return applePlatform() && !homeScreenApp() ? 'install-required' : 'unsupported';
  }

  permission(): PushPermission {
    if (typeof Notification === 'undefined') return 'unknown';
    return readPermission(Notification.permission);
  }

  async requestPermission(): Promise<PushPermission> {
    if (typeof Notification === 'undefined') return 'unknown';
    return readPermission(await Notification.requestPermission());
  }

  /** Reads existing state only: with no worker registered there is nothing to read. */
  async current(): Promise<BrowserSubscription | null> {
    const registration = await this.existing();
    const subscription = registration === null ? null : await registration.pushManager.getSubscription();
    return subscription === null || subscription === undefined ? null : describeSubscription(subscription);
  }

  async subscribe(applicationServerKey: string): Promise<BrowserSubscription> {
    const key = isApplicationServerKey(applicationServerKey) ? fromBase64Url(applicationServerKey) : null;
    if (key === null) throw new PushError('browser');
    const registration = await this.install();
    // userVisibleOnly is mandatory: every wake must be able to show the user something.
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return describeSubscription(subscription);
  }

  async unsubscribe(): Promise<boolean> {
    const registration = await this.existing();
    const subscription = registration === null ? null : await registration.pushManager.getSubscription();
    return subscription === null || subscription === undefined ? false : subscription.unsubscribe();
  }

  private async existing(): Promise<ServiceWorkerRegistration | null> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    return (await navigator.serviceWorker.getRegistration('/')) ?? null;
  }

  /**
   * Installs the worker. This is the only method that registers it, so visiting the site never
   * installs a worker by itself: it happens inside the user action that enrolls this browser.
   */
  private async install(): Promise<ServiceWorkerRegistration> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) throw new PushError('browser');
    await navigator.serviceWorker.register(this.scriptUrl, { scope: '/' });
    return navigator.serviceWorker.ready;
  }
}
