import { retryDelay, systemClock, type Clock } from "./clock.js";

export interface RetryOptions {
  signal: AbortSignal;
  clock?: Clock;
  random?: () => number;
  attempts?: number;
}

export async function retryRequest<T>(
  request: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const clock = options.clock ?? systemClock;
  const random = options.random ?? Math.random;
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; ; attempt++) {
    if (options.signal.aborted)
      throw options.signal.reason ?? new Error("Request aborted before dispatch");
    try {
      return await request();
    } catch (error) {
      if (attempt + 1 >= attempts || !retryable(error)) throw error;
      const retryAfter = retryAfterMilliseconds(error, clock.now());
      await clock.sleep(retryDelay(attempt, retryAfter, random), options.signal);
    }
  }
}

export async function withDeadline<T>(
  parent: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (parent.aborted) throw parent.reason ?? new Error("Operation aborted before dispatch");
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason ?? new Error("Operation aborted"));
  parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("HTTP deadline aborted")), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
  }
}

function retryable(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export function retryAfterMilliseconds(error: unknown, now: number): number | undefined {
  const headers = (error as { response?: { headers?: Record<string, unknown> } }).response
    ?.headers;
  const value = headers?.["retry-after"];
  if (typeof value !== "string") return undefined;
  if (/^[0-9]+$/.test(value)) return Number(value) * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
