import { describe, expect, test } from "vite-plus/test";
import type { Clock } from "./clock.js";
import { retryAfterMilliseconds, retryRequest, withDeadline } from "./retry.js";

describe("bounded request retries", () => {
  test("honours bounded Retry-After with injected clock and randomness", async () => {
    const delays: number[] = [];
    const clock: Clock = {
      now: () => 1_000,
      sleep: async (ms) => {
        delays.push(ms);
      },
    };
    let attempts = 0;
    const result = await retryRequest(
      async () => {
        if (++attempts === 1)
          throw Object.assign(new Error("rate limited"), {
            status: 429,
            response: { headers: { "retry-after": "99" } },
          });
        return "ok";
      },
      { signal: new AbortController().signal, clock, random: () => 0 },
    );
    expect(result).toBe("ok");
    expect({ attempts, delays }).toEqual({ attempts: 2, delays: [10_000] });
  });

  test("does not retry authorization errors and stops before an aborted request", async () => {
    let attempts = 0;
    await expect(
      retryRequest(
        async () => {
          attempts++;
          throw Object.assign(new Error("forbidden"), { status: 403 });
        },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow(/forbidden/i);
    expect(attempts).toBe(1);
    const controller = new AbortController();
    controller.abort();
    await expect(retryRequest(async () => "bad", { signal: controller.signal })).rejects.toThrow(
      /abort/i,
    );
  });

  test("aborts a request at its explicit deadline", async () => {
    await expect(
      withDeadline(new AbortController().signal, 10, async (signal) => {
        await new Promise<void>((resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("deadline aborted")), {
            once: true,
          });
        });
      }),
    ).rejects.toThrow(/deadline.*abort/i);
  });

  test("parses numeric and HTTP-date Retry-After while rejecting malformed values", () => {
    const withHeader = (value: unknown) => ({ response: { headers: { "retry-after": value } } });
    expect(retryAfterMilliseconds(withHeader("2"), 1_000)).toBe(2_000);
    expect(retryAfterMilliseconds(withHeader("Thu, 01 Jan 1970 00:00:02 GMT"), 1_000)).toBe(1_000);
    expect(retryAfterMilliseconds(withHeader("Thu, 01 Jan 1970 00:00:00 GMT"), 1_000)).toBe(0);
    expect(retryAfterMilliseconds(withHeader("invalid"), 1_000)).toBeUndefined();
    expect(retryAfterMilliseconds(withHeader(2), 1_000)).toBeUndefined();
    expect(retryAfterMilliseconds({}, 1_000)).toBeUndefined();
  });

  test("covers bounded retry exhaustion and parent deadline propagation", async () => {
    for (const status of [502, 503, 504]) {
      let attempts = 0;
      await expect(
        retryRequest(
          async () => {
            attempts++;
            throw Object.assign(new Error("temporary"), { status });
          },
          {
            signal: new AbortController().signal,
            attempts: 2,
            clock: { now: () => 0, sleep: async () => undefined },
            random: () => 0,
          },
        ),
      ).rejects.toThrow(/temporary/i);
      expect(attempts).toBe(2);
    }
    await expect(withDeadline(new AbortController().signal, 100, async () => "ok")).resolves.toBe(
      "ok",
    );
    const preaborted = new AbortController();
    preaborted.abort(new Error("parent stopped"));
    await expect(withDeadline(preaborted.signal, 100, async () => "bad")).rejects.toThrow(
      /parent stopped/i,
    );
    const parent = new AbortController();
    await expect(
      withDeadline(parent.signal, 1_000, async (signal) => {
        parent.abort(new Error("cancelled"));
        if (signal.aborted) throw signal.reason;
        await new Promise<void>((resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      }),
    ).rejects.toThrow(/cancelled/i);
  });
});
