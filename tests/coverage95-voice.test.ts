import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { recognitionSupported, speakResponse, startMicrophoneInterruption, startRecognition, startVoiceInterruption, type RecognitionError } from "@/services/voice/browserVoice";

function mockBrowser(context: TestContext, values: Record<string, unknown>) {
  const descriptors = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  context.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
}

type StubResult = { isFinal: boolean; 0: { transcript: string } };
type StubEvent = { resultIndex: number; results: StubResult[] };
const speech = (transcript: string, isFinal: boolean): StubResult => ({ isFinal, 0: { transcript } });
const event = (...results: StubResult[]): StubEvent => ({ resultIndex: 0, results });
const named = (name: string) => Object.assign(new Error(name), { name });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

class VoiceStub {
  static latest: VoiceStub;
  static onStart: ((self: VoiceStub) => void) | undefined;
  lang = "";
  aborted = false;
  starts = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: StubEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { VoiceStub.latest = this; }
  start() { this.starts += 1; VoiceStub.onStart?.(this); }
  abort() { this.aborted = true; }
}

function voiceBrowser(context: TestContext, extra: Record<string, unknown> = {}) {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  VoiceStub.onStart = undefined;
  context.after(() => { VoiceStub.onStart = undefined; });
  mockBrowser(context, { window: { SpeechRecognition: VoiceStub }, navigator: { language: "en-US" }, ...extra });
}

test("recognition support detection and unsupported browsers", (context) => {
  assert.equal(recognitionSupported(), false);
  mockBrowser(context, { window: { webkitSpeechRecognition: VoiceStub } });
  assert.equal(recognitionSupported(), true);
  (globalThis as { window?: unknown }).window = {};
  assert.equal(recognitionSupported(), false);
  const errors: RecognitionError[] = [];
  const stop = startRecognition({ onTranscript: () => {}, onError: (reason) => errors.push(reason), onEnd: () => {} });
  stop();
  assert.deepEqual(errors, ["unsupported"]);
});

test("recognition falls back to en-US for a non-English browser language", (context) => {
  voiceBrowser(context, { navigator: { language: "fr-FR" } });
  context.after(startRecognition({ onTranscript: () => {}, onError: () => {}, onEnd: () => {} }));
  assert.equal(VoiceStub.latest.lang, "en-US");
});

test("startup exceptions map to actionable categories with and without an audio track", (context) => {
  voiceBrowser(context);
  const track = (readyState: string) => ({ readyState }) as unknown as MediaStreamTrack;
  const cases: [unknown, MediaStreamTrack | undefined, RecognitionError][] = [
    [named("NotAllowedError"), undefined, "permission"],
    [named("SecurityError"), undefined, "permission"],
    [named("InvalidStateError"), undefined, "busy"],
    [named("NotSupportedError"), undefined, "unsupported"],
    [named("NotFoundError"), undefined, "audio-capture"],
    [named("NotReadableError"), undefined, "audio-capture"],
    ["not an Error", undefined, "unknown"],
    [named("TypeError"), undefined, "unknown"],
    [named("TypeError"), track("live"), "audio-track"],
    [named("NotSupportedError"), track("live"), "audio-track"],
    [named("InvalidStateError"), track("ended"), "audio-track"],
    [named("InvalidStateError"), track("live"), "busy"],
    [named("SomethingElse"), track("live"), "unknown"],
  ];
  for (const [failure, audioTrack, expected] of cases) {
    VoiceStub.onStart = () => { throw failure; };
    const errors: RecognitionError[] = [];
    startRecognition({ audioTrack, onTranscript: () => {}, onError: (reason) => errors.push(reason), onEnd: () => {} });
    assert.deepEqual(errors, [expected], String(failure));
    assert.equal(VoiceStub.latest.aborted, true);
  }
});

test("errors reported while starting end the session exactly once", (context) => {
  voiceBrowser(context);
  let ended = 0;
  const errors: RecognitionError[] = [];
  VoiceStub.onStart = (recognition) => recognition.onerror?.({ error: "network" });
  startRecognition({ onTranscript: () => {}, onError: (reason) => errors.push(reason), onEnd: () => { ended += 1; } });
  context.mock.timers.tick(90000);
  assert.deepEqual(errors, ["network"]);
  assert.equal(ended, 0);
  VoiceStub.onStart = (recognition) => { recognition.onerror?.({ error: "network" }); throw named("NotFoundError"); };
  startRecognition({ onTranscript: () => {}, onError: (reason) => errors.push(reason), onEnd: () => {} });
  assert.deepEqual(errors, ["network", "network"]);
});

test("browser error codes map to recognition errors and late events are ignored", (context) => {
  voiceBrowser(context);
  const expectations: Record<string, RecognitionError | undefined> = {
    "not-allowed": "permission", "service-not-allowed": "permission", network: "network", "no-speech": "no-speech",
    "audio-capture": "audio-capture", "language-not-supported": "language", bogus: "unknown", aborted: undefined,
  };
  for (const [code, expected] of Object.entries(expectations)) {
    const errors: RecognitionError[] = [];
    const stop = startRecognition({ onTranscript: () => {}, onError: (reason) => errors.push(reason), onEnd: () => {} });
    const recognition = VoiceStub.latest;
    const late = recognition.onerror;
    recognition.onerror?.({ error: code });
    late?.({ error: code });
    assert.deepEqual(errors, expected ? [expected] : [], code);
    stop();
  }
  const errors: RecognitionError[] = [];
  const stop = startRecognition({ onComplete: () => {}, onTranscript: () => {}, onError: (reason) => errors.push(reason), onEnd: () => {} });
  VoiceStub.latest.onerror?.({ error: "no-speech" });
  assert.deepEqual(errors, []);
  stop();
});

test("recognition ending without completion handling finishes, while stale restarts are ignored", (context) => {
  voiceBrowser(context);
  let ended = 0;
  startRecognition({ onTranscript: () => {}, onError: () => {}, onEnd: () => { ended += 1; } });
  VoiceStub.latest.onend?.();
  assert.equal(ended, 1);

  const stop = startRecognition({ keepAlive: true, onComplete: () => {}, onTranscript: () => {}, onError: () => {}, onEnd: () => {} });
  const recognition = VoiceStub.latest;
  recognition.onend?.();
  recognition.onend?.();
  stop();
  context.mock.timers.tick(150);
  assert.equal(recognition.starts, 1);

  const delayed = startRecognition({ keepAlive: true, startDelayMs: 100, onComplete: () => {}, onTranscript: () => {}, onError: () => {}, onEnd: () => {} });
  const waiting = VoiceStub.latest;
  waiting.onend?.();
  delayed();
  context.mock.timers.tick(500);
  assert.equal(waiting.starts, 0);
});

test("rejected transcripts are retained, dropped, or discarded according to the callbacks", (context) => {
  voiceBrowser(context);
  const seen: string[] = [];
  const base = { onTranscript: (text: string) => seen.push(text), onError: () => {}, onEnd: () => {} };

  let stop = startRecognition({ ...base, acceptTranscript: () => false, retainRejectedTranscript: () => false });
  VoiceStub.latest.onresult?.(event(speech("noise", true)));
  stop();

  stop = startRecognition({ ...base, acceptTranscript: () => false, retainRejectedTranscript: () => true });
  VoiceStub.latest.onresult?.(event(speech("kept", true)));
  stop();

  stop = startRecognition({ ...base, initialTranscript: "earlier", acceptTranscript: () => false });
  VoiceStub.latest.onresult?.(event(speech("rejected", true)));
  stop();
  assert.deepEqual(seen, []);
});

test("discard without keepAlive ends the recording and a handler that stops cannot also complete", (context) => {
  voiceBrowser(context);
  const transcripts: [string, boolean][] = [];
  let ended = 0;
  let discarded = 0;
  startRecognition({ onDiscard: () => { discarded += 1; }, onTranscript: (text, final) => transcripts.push([text, final]), onError: () => {}, onEnd: () => { ended += 1; } });
  VoiceStub.latest.onresult?.(event(speech("Discard", true)));
  assert.deepEqual(transcripts, [["", true]]);
  assert.equal(discarded, 1);
  assert.equal(ended, 1);

  const completed: string[] = [];
  let stop = () => {};
  stop = startRecognition({ onComplete: (text) => completed.push(text), onTranscript: () => stop(), onError: () => {}, onEnd: () => {} });
  VoiceStub.latest.onresult?.(event(speech("Charminar Send", true)));
  assert.deepEqual(completed, []);
});

test("interruption ignores results that arrive after the caller stopped and treats unconfigured option counts as zero", (context) => {
  voiceBrowser(context);
  let stop = () => {};
  stop = startVoiceInterruption({ onResult: () => stop(), onSpeech: () => assert.fail("stopped"), onError: () => {} });
  VoiceStub.latest.onresult?.(event(speech("hello there", false)));

  const spoken: string[] = [];
  const stopSecond = startVoiceInterruption({ onSpeech: (text) => spoken.push(text), onError: () => {} });
  VoiceStub.latest.onresult?.(event(speech("option two Submit", true)));
  stopSecond();
  assert.deepEqual(spoken, ["option two"]);
});

test("option counts supplied by a callback bound which spoken options are recognized", (context) => {
  voiceBrowser(context);
  const spoken: string[] = [];
  const stop = startVoiceInterruption({ getOptionCount: () => 3, onSpeech: (text) => spoken.push(text), onTranscript: () => {}, onError: () => {} });
  VoiceStub.latest.onresult?.(event(speech("option two Submit", true)));
  stop();
  assert.deepEqual(spoken, ["option two"]);
});

test("recognition end events delivered after stopping are ignored", (context) => {
  voiceBrowser(context);
  let ended = 0;
  const stop = startRecognition({ onTranscript: () => {}, onError: () => {}, onEnd: () => { ended += 1; } });
  const late = VoiceStub.latest.onend;
  stop();
  late?.();
  assert.equal(ended, 0);
});

test("microphone interruption cancelled before capture resolves never falls back or reports twice", async (context) => {
  let rejectCapture: (error: unknown) => void = () => {};
  voiceBrowser(context, { navigator: { language: "en-US", mediaDevices: { getUserMedia: () => new Promise((_, reject) => { rejectCapture = reject; }) } } });
  const errors: string[] = [];
  const fallbacks: string[] = [];
  const stop = startMicrophoneInterruption({ onSpeech: () => {}, onError: (message) => errors.push(message), onCaptureFallback: (message) => fallbacks.push(message) });
  stop();
  rejectCapture(new DOMException("denied", "NotAllowedError"));
  await settle();

  const stopGeneric = startMicrophoneInterruption({ onSpeech: () => {}, onError: (message) => errors.push(message), onCaptureFallback: (message) => fallbacks.push(message) });
  stopGeneric();
  rejectCapture(new Error("device failure"));
  await settle();
  assert.deepEqual(errors, []);
  assert.deepEqual(fallbacks, []);
});

test("microphone interruption stops when the fallback notification cancels it", async (context) => {
  voiceBrowser(context, { navigator: { language: "en-US", mediaDevices: { getUserMedia: async () => { throw new Error("device failure"); } } } });
  let stop = () => {};
  let fallbacks = 0;
  const starts = () => VoiceStub.latest?.starts ?? 0;
  const before = starts();
  stop = startMicrophoneInterruption({ onSpeech: () => {}, onError: () => assert.fail("cancelled"), onCaptureFallback: () => { fallbacks += 1; stop(); } });
  await settle();
  assert.equal(fallbacks, 1);
  assert.equal(starts(), before);
});

test("a native recognition failure during fallback startup is reported once", (context) => {
  voiceBrowser(context);
  VoiceStub.onStart = (recognition) => recognition.onerror?.({ error: "network" });
  const errors: string[] = [];
  startMicrophoneInterruption({ onSpeech: () => {}, onError: (message) => errors.push(message) });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /speech service could not connect/);
});

test("processed-track recognition that ends after speech releases the microphone and notifies the caller", async (context) => {
  let released = 0;
  const track = { readyState: "live", getSettings: () => ({ echoCancellation: true }), stop: () => { released += 1; } } as unknown as MediaStreamTrack;
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  voiceBrowser(context, { navigator: { language: "en-US", mediaDevices: { getUserMedia: async () => stream } } });
  const spoken: string[] = [];
  let ended = 0;
  const stop = startMicrophoneInterruption({ onSpeech: (text) => spoken.push(text), onEnd: () => { ended += 1; }, onError: (message) => assert.fail(message) });
  await settle();
  VoiceStub.latest.onresult?.(event(speech("hello there", false)));
  VoiceStub.latest.onend?.();
  assert.deepEqual(spoken, ["hello there"]);
  assert.equal(ended, 1);
  assert.equal(released, 1);
  stop();
});

class VoiceUtterance {
  lang = "";
  rate = 1;
  pitch = 1;
  volume = 0;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public readonly text: string) {}
}

function synthesisBrowser(context: TestContext, navigatorValue: unknown = { language: "en-US" }) {
  const utterances: VoiceUtterance[] = [];
  mockBrowser(context, {
    navigator: navigatorValue,
    SpeechSynthesisUtterance: VoiceUtterance,
    window: { speechSynthesis: { cancel: () => {}, resume: () => {}, getVoices: () => [], speak: (utterance: VoiceUtterance) => utterances.push(utterance) } },
  });
  return utterances;
}

test("speech output reports an unsupported browser", (context) => {
  mockBrowser(context, { window: {}, navigator: { language: "en-US" } });
  const messages: string[] = [];
  let ended = 0;
  const stop = speakResponse("Hello", () => { ended += 1; }, (message) => messages.push(message));
  stop();
  assert.equal(ended, 1);
  assert.match(messages[0], /not available in this browser/);
  speakResponse("Hello", () => { ended += 1; })();
  assert.equal(ended, 2);
});

test("speech output defaults to en-US, handles missing sentence segmentation, and splits long sentences", (context) => {
  const utterances = synthesisBrowser(context, { language: "fr-FR" });
  speakResponse("Hello", () => {})();
  assert.equal(utterances[0].lang, "en-US");

  const original = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
  Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
  context.after(() => { if (original) Object.defineProperty(Intl, "Segmenter", original); });
  const longText = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
  speakResponse(longText, () => {});
  for (let index = 1; utterances[index]; index += 1) utterances[index].onend?.();
  const chunks = utterances.slice(1);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.map((chunk) => chunk.text).join(" "), longText);
});

test("playback errors are reported once and cancellations stay silent", (context) => {
  const utterances = synthesisBrowser(context);
  const messages: string[] = [];
  let ended = 0;
  speakResponse("First sentence.", () => { ended += 1; }, (message) => messages.push(message));
  utterances[0].onerror?.({ error: "audio-busy" });
  utterances[0].onerror?.({ error: "audio-busy" });
  assert.equal(messages.length, 1);
  assert.equal(ended, 1);

  speakResponse("Second sentence.", () => { ended += 1; }, (message) => messages.push(message));
  utterances[1].onerror?.({ error: "canceled" });
  assert.equal(messages.length, 1);
  assert.equal(ended, 2);
});
