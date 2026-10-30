import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";

export class ServiceError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

const cache = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
const limits = new Map<string, number>();
const queues = new Map<string, { tail: Promise<unknown>; startedAt: number; count: number }>();

export async function cached<Value>(key: string, ttl: number, load: () => Promise<Value>): Promise<Value> {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.value as Value;
  const running = pending.get(key);
  if (running) return running as Promise<Value>;
  const job = load().then((value) => {
    if (cache.size >= 300) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

async function serialized<Value>(service: string, load: () => Promise<Value>): Promise<Value> {
  let queue = queues.get(service);
  if (!queue) { queue = { tail: Promise.resolve(), startedAt: 0, count: 0 }; queues.set(service, queue); }
  const state = queue;
  if (state.count >= 6) throw new ServiceError(`${service} is busy. Please wait a moment and retry.`, 429);
  state.count += 1;
  const job = state.tail.catch(() => undefined).then(async () => {
    const delay = Math.max(0, 1100 - (Date.now() - state.startedAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    state.startedAt = Date.now();
    return load();
  }).finally(() => { state.count -= 1; });
  state.tail = job;
  return job;
}

export const serializedGeocode = <Value>(load: () => Promise<Value>) => serialized("Address search", load);
export const serializedRouting = <Value>(load: () => Promise<Value>) => serialized("Routing", load);

export function throttle(key: string, interval: number): void {
  const now = Date.now();
  if ((limits.get(key) ?? 0) > now) throw new ServiceError("Too many requests. Please wait a few seconds and retry.", 429);
  limits.set(key, now + interval);
}

export async function upstream(url: string | URL, identity: string, init?: RequestInit): Promise<unknown> {
  try {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    headers.set("User-Agent", `VoiceNav-AI/0.1 (${identity})`);
    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(25000),
      cache: "no-store",
    });
    if (response.status === 429) throw new ServiceError("The public service is rate limited. Please try again later.", 429);
    if (!response.ok) throw new ServiceError(`The public service is unavailable (HTTP ${response.status}). Please retry later.`);
    return await response.json();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new ServiceError("The public service timed out. Please try again later.", 504);
    throw new ServiceError("Unable to reach the public service. Check your connection and retry.");
  }
}

export async function api<Input, Output>(request: NextRequest, schema: z.ZodType<Input>, handle: (input: Input, identity: string) => Promise<Output>) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) throw new ServiceError("Cross-origin requests are not allowed.", 403);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new ServiceError("Expected a JSON request.", 415);
    if (Number(request.headers.get("content-length")) > 1_500_000) throw new ServiceError("Request is too large.", 413);
    const reader = request.body?.getReader();
    if (!reader) throw new ServiceError("A request body is required.", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_500_000) { await reader.cancel(); throw new ServiceError("Request is too large.", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let json: unknown;
    try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ServiceError("Invalid JSON request.", 400); }
    const input = schema.safeParse(json);
    if (!input.success) throw new ServiceError("Invalid request. Check the locations, category, or route geometry.", 400);
    return NextResponse.json(await handle(input.data, request.nextUrl.origin), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ServiceError ? error.message : "The service returned invalid data. Please try again later." }, { status: error instanceof ServiceError ? error.status : 502 });
  }
}