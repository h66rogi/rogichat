/*
 * 로기챗 service worker foundation (FW01).
 *
 * This file exists so the web origin serves `/sw.js` as JavaScript with a revalidating cache policy
 * (see next.config.ts headers) and so the install/standalone shape can be verified early.
 *
 * It is intentionally inactive:
 * - no `fetch` handler: every request goes to the network; nothing is cached by the worker.
 * - no `push` / `notificationclick` handlers: Web Push is connected only after the server subscription
 *   contract and the opaque account-binding generation (W07 / M11) exist.
 * - the page never calls `navigator.serviceWorker.register()` in FW01; registration and permission
 *   prompts start from an explicit user action in settings once the contract is ready.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
