import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { GET as configGet } from "@/app/api/voice/config/route";
import { POST as transcribePost } from "@/app/api/voice/transcribe/route";

function request(origin = "https://app.test", body?: FormData): NextRequest {
  return new NextRequest("https://app.test/api/voice/transcribe", {
    method: "POST",
    headers: { origin, ...(body ? {} : { "content-type": "multipart/form-data; boundary=test" }) },
    body: body as BodyInit | undefined,
  });
}

function audioForm(): FormData {
  const form = new FormData();
  form.append("audio", new File(["audio"], "voice.webm", { type: "audio/webm" }));
  return form;
}

test("MMS is disabled by default and config exposes no server details", async () => {
  const previous = process.env.META_MMS_ENABLED;
  delete process.env.META_MMS_ENABLED;
  try {
    assert.deepEqual(await (await configGet()).json(), { mmsEnabled: false });
    const result = await transcribePost(request("https://app.test", audioForm()));
    assert.equal(result.status, 503);
    assert.match(JSON.stringify(await result.json()), /disabled/);
  } finally {
    if (previous === undefined) delete process.env.META_MMS_ENABLED;
    else process.env.META_MMS_ENABLED = previous;
  }
});

test("enabled MMS rejects cross-origin requests before proxying", async () => {
  const previous = process.env.META_MMS_ENABLED;
  process.env.META_MMS_ENABLED = "true";
  try {
    const result = await transcribePost(request("https://evil.test", audioForm()));
    assert.equal(result.status, 403);
  } finally {
    if (previous === undefined) delete process.env.META_MMS_ENABLED;
    else process.env.META_MMS_ENABLED = previous;
  }
});

test("enabled MMS proxies audio and validates the transcription contract", async (context) => {
  const previousEnabled = process.env.META_MMS_ENABLED;
  const previousUrl = process.env.META_MMS_SERVICE_URL;
  process.env.META_MMS_ENABLED = "on";
  process.env.META_MMS_SERVICE_URL = "http://127.0.0.1:8001";
  context.mock.method(globalThis, "fetch", async (url: string | URL, init: RequestInit) => {
    assert.equal(String(url), "http://127.0.0.1:8001/transcribe");
    assert.equal(init.method, "POST");
    assert.ok(init.body instanceof FormData);
    assert.equal((init.body.get("audio") as File).name, "voice.webm");
    return Response.json({
      success: true,
      text: "Take me to Hyderabad",
      provider: "meta-mms",
      model: "facebook/mms-1b-all",
      language: "eng",
      inferenceTimeMs: 42,
    });
  });
  try {
    const result = await transcribePost(request("https://app.test", audioForm()));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).text, "Take me to Hyderabad");
  } finally {
    if (previousEnabled === undefined) delete process.env.META_MMS_ENABLED;
    else process.env.META_MMS_ENABLED = previousEnabled;
    if (previousUrl === undefined) delete process.env.META_MMS_SERVICE_URL;
    else process.env.META_MMS_SERVICE_URL = previousUrl;
  }
});

test("MMS reports malformed upstream output and unavailable service safely", async (context) => {
  const previousEnabled = process.env.META_MMS_ENABLED;
  process.env.META_MMS_ENABLED = "1";
  try {
    context.mock.method(globalThis, "fetch", async () => Response.json({ success: true, text: "missing metadata" }));
    const malformed = await transcribePost(request("https://app.test", audioForm()));
    assert.equal(malformed.status, 502);
    assert.match(JSON.stringify(await malformed.json()), /invalid transcription/);

    context.mock.method(globalThis, "fetch", async () => { throw new Error("connection refused"); });
    const unavailable = await transcribePost(request("https://app.test", audioForm()));
    assert.equal(unavailable.status, 502);
    assert.match(JSON.stringify(await unavailable.json()), /service is unavailable/);
  } finally {
    if (previousEnabled === undefined) delete process.env.META_MMS_ENABLED;
    else process.env.META_MMS_ENABLED = previousEnabled;
  }
});
