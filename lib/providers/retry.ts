/**
 * One more try when Mistral says it is busy. A rate limit (429) or a briefly failing server
 * (502, 503, 504) used to fail the whole report [191]; a timeout or any other error is not
 * retried, so the report keeps within the route's 30 s.
 */
const RETRY_STATUS = new Set([429, 502, 503, 504]);
/** Tries after the first one. */
export const MAX_RETRIES = 2;
/** Never wait longer than this, whatever Retry-After asks: the speaker is waiting. */
export const MAX_WAIT_MS = 2000;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** How long to wait before try `attempt` (1-based): Retry-After in seconds if given, else 0.5 s then 1 s. */
export function retryWaitMs(res: Response, attempt: number): number {
  const after = Number(res.headers.get("retry-after"));
  const ms = Number.isFinite(after) && res.headers.has("retry-after") ? after * 1000 : 500 * 2 ** (attempt - 1);
  return Math.min(MAX_WAIT_MS, Math.max(0, ms));
}

/**
 * fetch, tried again on a busy answer. `init` is called for each try, so each gets a fresh
 * timeout signal. The last answer is returned as it is, busy or not, for the caller to report.
 */
export async function fetchRetrying(url: string, init: () => RequestInit, sleep: (ms: number) => Promise<void> = realSleep): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init());
    if (!RETRY_STATUS.has(res.status) || attempt >= MAX_RETRIES) return res;
    const wait = retryWaitMs(res, attempt + 1);
    console.warn(`[retry] ${new URL(url).host} answered ${res.status}; trying again in ${wait} ms`);
    await res.body?.cancel();
    await sleep(wait);
  }
}
