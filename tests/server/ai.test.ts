import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { BasetenIntentProvider } from "@/ai/providers/BasetenIntentProvider";
import { IntentProcessor } from "@/ai/IntentProcessor";
import { emptyContext } from "@/conversation/ConversationContext";
import { emptySession } from "@/navigation/NavigationSession";
import { inferBasetenIntent } from "@/services/ai/baseten";
import { POST as intentPost } from "@/app/api/ai/intent/route";

const input = { text: "How long will it take?", context: emptyContext(), session: emptySession() };
const requestBody = {
  text: input.text,
  language: "en" as const,
  recentPlaces: [],
  recentMessages: [],
  lastSearchScope: null,
  session: { hasOrigin: false, hasDestination: false, hasRoute: false, destinationName: null },
};

function response(content: string, status = 200): Response {
  return Response.json({ choices: [{ message: { content } }] }, { status });
}

function adapterResponse(intent: unknown, status = 200): Response {
  return Response.json({ intent, provider: "muse" }, { status });
}

test("Baseten adapter accepts a validated structured intent and reports connection", async () => {
  const requests: RequestInit[] = [];
  const provider = new BasetenIntentProvider(async (_url, init) => {
    requests.push(init ?? {});
    return adapterResponse({ type: "GET_ETA" });
  });
  assert.deepEqual(await provider.process(input), { type: "GET_ETA" });
  assert.equal(provider.getStatus(), "connected");
  assert.equal(JSON.parse(String(requests[0].body)).text, input.text);
});

test("missing Baseten configuration keeps the local engine active", async () => {
  const provider = new BasetenIntentProvider(async () => Response.json({ error: "not configured" }, { status: 503 }));
  const intent = await new IntentProcessor(provider).process(input);
  assert.deepEqual(intent, { type: "GET_ETA" });
  assert.equal(provider.getStatus(), "local");
});

test("invalid model JSON and schema output are rejected for fallback", async () => {
  for (const intent of ["not-json", { type: "UNSAFE" }]) {
    const provider = new BasetenIntentProvider(async () => adapterResponse(intent));
    await assert.rejects(provider.process(input), /invalid intent|malformed JSON/);
    assert.equal(provider.getStatus(), "unavailable");
  }
});

test("timeouts and rate limits become unavailable without retries", async () => {
  const timeout = new BasetenIntentProvider(async () => { throw new DOMException("timed out", "TimeoutError"); });
  await assert.rejects(timeout.process(input));
  assert.equal(timeout.getStatus(), "unavailable");
  const rateLimited = new BasetenIntentProvider(async () => response("rate limited", 429));
  await assert.rejects(rateLimited.process(input));
  assert.equal(rateLimited.getStatus(), "unavailable");
});

test("server route invokes the OpenAI-compatible Baseten endpoint without exposing credentials", async (context) => {
  const previous = process.env.BASETEN_API_KEY;
  const previousEnabled = process.env.BASETEN_ENABLED;
  process.env.BASETEN_API_KEY = "test-only-key";
  process.env.BASETEN_ENABLED = "on";
  context.mock.method(globalThis, "fetch", async (url: string | URL, init: RequestInit) => {
    assert.match(String(url), /inference\.baseten\.co\/v1\/chat\/completions/);
    const payload = JSON.parse(String(init.body)) as { model: string; max_tokens: number; messages: Array<{ role: string; content: string }> };
    assert.equal(payload.model, "meta-models/muse-spark-open");
    assert.equal(payload.max_tokens, 180);
    assert.doesNotMatch(JSON.stringify(payload), /test-only-key/);
    return response('{"type":"GET_ETA"}');
  });
  try {
    const result = await intentPost(new NextRequest("https://app.test/api/ai/intent", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.test" }, body: JSON.stringify(requestBody) }));
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).intent, { type: "GET_ETA" });
  } finally {
    if (previous === undefined) delete process.env.BASETEN_API_KEY;
    else process.env.BASETEN_API_KEY = previous;
    if (previousEnabled === undefined) delete process.env.BASETEN_ENABLED;
    else process.env.BASETEN_ENABLED = previousEnabled;
  }
});

test("server route reports missing configuration without calling upstream", async () => {
  const previous = process.env.BASETEN_API_KEY;
  const previousEnabled = process.env.BASETEN_ENABLED;
  const previousGeminiEnabled = process.env.GEMINI_ENABLED;
  delete process.env.BASETEN_API_KEY;
  delete process.env.BASETEN_ENABLED;
  delete process.env.GEMINI_ENABLED;
  try {
    const result = await intentPost(new NextRequest("https://app.test/api/ai/intent", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.test" }, body: JSON.stringify(requestBody) }));
    assert.equal(result.status, 503);
  } finally {
    if (previous !== undefined) process.env.BASETEN_API_KEY = previous;
    if (previousEnabled !== undefined) process.env.BASETEN_ENABLED = previousEnabled;
    if (previousGeminiEnabled !== undefined) process.env.GEMINI_ENABLED = previousGeminiEnabled;
  }
});

test("Gemini is selected when enabled and Muse remains untouched", async (context) => {
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousGeminiEnabled = process.env.GEMINI_ENABLED;
  const previousMuseKey = process.env.BASETEN_API_KEY;
  const previousMuseEnabled = process.env.BASETEN_ENABLED;
  process.env.GEMINI_API_KEY = "gemini-test-key";
  process.env.GEMINI_ENABLED = "on";
  process.env.BASETEN_API_KEY = "muse-test-key";
  process.env.BASETEN_ENABLED = "on";
  context.mock.method(globalThis, "fetch", async (url: string | URL, init: RequestInit) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    assert.equal(new Headers(init.headers).get("x-goog-api-key"), "gemini-test-key");
    assert.doesNotMatch(JSON.stringify(init), /muse-test-key/);
    return Response.json({ candidates: [{ content: { parts: [{ text: '{"type":"GET_ETA"}' }] } }] });
  });
  try {
    const result = await intentPost(new NextRequest("https://app.test/api/ai/intent", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.test" }, body: JSON.stringify(requestBody) }));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { intent: { type: "GET_ETA" }, provider: "gemini" });
  } finally {
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
    if (previousGeminiEnabled === undefined) delete process.env.GEMINI_ENABLED;
    else process.env.GEMINI_ENABLED = previousGeminiEnabled;
    if (previousMuseKey === undefined) delete process.env.BASETEN_API_KEY;
    else process.env.BASETEN_API_KEY = previousMuseKey;
    if (previousMuseEnabled === undefined) delete process.env.BASETEN_ENABLED;
    else process.env.BASETEN_ENABLED = previousMuseEnabled;
  }
});

test("server route rejects malformed model content", async (context) => {
  const previous = process.env.BASETEN_API_KEY;
  const previousEnabled = process.env.BASETEN_ENABLED;
  process.env.BASETEN_API_KEY = "test-only-key";
  process.env.BASETEN_ENABLED = "on";
  context.mock.method(globalThis, "fetch", async () => new Response("{not-json", { status: 200, headers: { "content-type": "application/json" } }));
  try {
    const result = await intentPost(new NextRequest("https://app.test/api/ai/intent", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.test" }, body: JSON.stringify(requestBody) }));
    assert.equal(result.status, 502);
  } finally {
    if (previous === undefined) delete process.env.BASETEN_API_KEY;
    else process.env.BASETEN_API_KEY = previous;
    if (previousEnabled === undefined) delete process.env.BASETEN_ENABLED;
    else process.env.BASETEN_ENABLED = previousEnabled;
  }
});

test("server route sanitizes invalid-key, credit, and rate-limit failures", async (context) => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousEnabled = process.env.GEMINI_ENABLED;
  process.env.GEMINI_API_KEY = "gemini-test-key";
  process.env.GEMINI_ENABLED = "on";
  try {
    for (const [upstreamStatus, expectedStatus] of [[401, 502], [402, 502], [429, 429]]) {
      context.mock.method(globalThis, "fetch", async () => Response.json({ error: "provider detail must stay private" }, { status: upstreamStatus }));
      const result = await intentPost(new NextRequest("https://app.test/api/ai/intent", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.test" }, body: JSON.stringify(requestBody) }));
      assert.equal(result.status, expectedStatus);
      assert.doesNotMatch(JSON.stringify(await result.json()), /provider detail/);
      context.mock.restoreAll();
    }
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousEnabled === undefined) delete process.env.GEMINI_ENABLED;
    else process.env.GEMINI_ENABLED = previousEnabled;
  }
});
