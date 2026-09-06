import { createHash } from "node:crypto";
export const api = "https://api.github.com";
export class ApiError extends Error {
  constructor(public status: number) {
    super(`GitHub request failed (${status})`);
  }
}
export async function bounded(response: Response, max = 8 * 1024 * 1024): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw Error("Missing response body");
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) throw Error("Response size limit exceeded");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function request<T = Record<string, unknown>>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  base = api,
): Promise<T> {
  if (!token) throw Error("Explicit GitHub token required");
  if (!path.startsWith("/") || path.startsWith("//")) throw Error("Invalid API path");
  const text = body === undefined ? undefined : JSON.stringify(body);
  if (text && Buffer.byteLength(text) > 16 * 1024 * 1024)
    throw Error("Request size limit exceeded");
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: text,
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  const bytes = await bounded(response);
  if (!response.ok) throw new ApiError(response.status);
  return (bytes.length ? JSON.parse(bytes.toString("utf8")) : {}) as T;
}
export async function pages<T>(
  path: string,
  token: string,
  field?: string,
  base = api,
): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = await request<T[] | Record<string, T[]>>(
      "GET",
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      token,
      undefined,
      base,
    );
    const rows = field ? (data as Record<string, T[]>)[field] : data;
    if (!Array.isArray(rows)) throw Error("Invalid paginated response");
    result.push(...rows);
    if (rows.length < 100) return result;
  }
  throw Error("Pagination limit exceeded");
}
export const marker = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface Message {
  id: number;
  number?: number;
  body: string;
}
export async function marked(
  path: string,
  body: Record<string, unknown> & { body?: string },
  id: string,
  token: string,
  base = api,
): Promise<Message> {
  const stamp = `<!-- snapcrafters-ci:${id} -->`;
  const find = async () =>
    (await pages<Message>(path, token, undefined, base)).find((item) => item.body?.includes(stamp));
  const existing = await find();
  if (existing) return existing;
  try {
    return await request<Message>(
      "POST",
      path,
      token,
      { ...body, body: `${body.body || ""}\n${stamp}` },
      base,
    );
  } catch (error) {
    const recovered = await find();
    if (recovered) return recovered;
    throw error;
  }
}
