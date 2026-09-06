import { createServer } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { retryRequest, withDeadline } from "../../src/runtime/retry.js";

let origin = "";
let rateRequests = 0;
let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://local.test");
    if (url.pathname === "/rate" && rateRequests++ === 0) {
      response.writeHead(429, { "retry-after": "0" }).end("rate limited");
      return;
    }
    if (url.pathname === "/auth") {
      response.writeHead(401).end("unauthorized");
      return;
    }
    if (url.pathname === "/large") {
      response.writeHead(200).end("x".repeat(2048));
      return;
    }
    if (url.pathname === "/slow") return;
    const page = Number(url.searchParams.get("page") ?? "1");
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ values: [page], next: page === 1 }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local HTTP address");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(() => server.close());

test("handles pagination, rate limits, authorization, limits, and deadlines at HTTP boundary", async () => {
  const signal = new AbortController().signal;
  const fetchPage = async (path: string, limit = 1024) =>
    withDeadline(signal, 100, async (deadline) => {
      const response = await fetch(`${origin}${path}`, { signal: deadline });
      if (!response.ok) {
        const error = Object.assign(new Error(`HTTP ${response.status}`), {
          status: response.status,
          response: { headers: Object.fromEntries(response.headers) },
        });
        throw error;
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > limit) throw new Error("HTTP response exceeds size limit");
      return body.toString();
    });
  await expect(retryRequest(() => fetchPage("/rate"), { signal, random: () => 0 })).resolves.toBe(
    JSON.stringify({ values: [1], next: true }),
  );
  const pages: number[] = [];
  for (let page = 1; ; page++) {
    const result = JSON.parse(await fetchPage(`/pages?page=${page}`)) as {
      values: number[];
      next: boolean;
    };
    pages.push(...result.values);
    if (!result.next) break;
  }
  expect(pages).toEqual([1, 2]);
  await expect(retryRequest(() => fetchPage("/auth"), { signal })).rejects.toThrow(/401/);
  await expect(fetchPage("/large", 100)).rejects.toThrow(/size limit/i);
  await expect(fetchPage("/slow")).rejects.toThrow(/abort|timeout/i);
});
