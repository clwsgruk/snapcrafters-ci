export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      const aborted = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Operation aborted"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", aborted);
        resolve();
      }, ms);
      signal.addEventListener("abort", aborted, { once: true });
    }),
};

export function retryDelay(
  attempt: number,
  retryAfterMs: number | undefined,
  random = Math.random,
): number {
  const requested = retryAfterMs ?? 250 * 2 ** attempt;
  return Math.min(10_000, requested) + Math.floor(random() * 100);
}
