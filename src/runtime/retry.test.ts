import { describe, expect, test } from "vite-plus/test";
import type { Clock } from "./clock.js";
import { retryRequest, withDeadline } from "./retry.js";

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
});
