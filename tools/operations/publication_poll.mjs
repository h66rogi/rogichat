export const POLL_INTERVAL_MS = 90_000;

// Returning true means the caller must perform another exact-source check,
// including when the sleep reaches the deadline exactly.
export async function waitForPublicationCheck(deadline, now = Date.now,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
  if (!Number.isFinite(deadline)) throw new Error('Invalid publication deadline');
  const remaining = deadline - now();
  if (remaining <= 0) return false;
  await sleep(Math.min(POLL_INTERVAL_MS, remaining));
  return true;
}
