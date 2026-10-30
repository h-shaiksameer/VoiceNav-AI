import { lastOptionIndex } from "@/navigation/commands";

export type RecognitionError = "permission" | "unsupported" | "network" | "no-speech" | "audio-track" | "audio-capture" | "language" | "busy" | "unknown";
export const VOICE_SEND_PHRASE = "Send";
export const HINDI_VOICE_SEND_PHRASE = "सेंड";
export const VOICE_INTERRUPT_PHRASE = "Hey Navigator";
export const HINDI_VOICE_INTERRUPT_PHRASE = "हे नेविगेटर";
const sendCommand = "(?:(?:navigator|नेविगेटर|नैविगेटर)[\\s,]+(?:send|सेंड)|(?:nova|no[\\s,-]+(?:or[\\s,-]+)?va|नोवा|नो[\\s,-]+वा)[\\s,]+(?:submit|सबमिट)|send|सेंड|submit|सबमिट)";
const discardCommand = "(?:discard|डिस्कार्ड)";
const interruptCommand = "(?:hey[\\s,]+navigator|हे[\\s,]+(?:नेविगेटर|नैविगेटर))";

export function sanitizeVoiceRequest(text: string): string {
  return text.normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b\ufeff]/gu, " ")
    .replace(/\[(?:background\s+noise|noise|music|silence)\]/giu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/(^|[.!?।॥]\s+)(?:(?:um+|uh+|erm+|hmm+)(?=[\s,;.!?।॥]|$)[\s,;.!?।॥]*)+/giu, "$1")
    .trim();
}

export function voiceRequest(text: string): string | null {
  const normalized = sanitizeVoiceRequest(text);
  const marker = new RegExp(`(?:^|[\\s,;:.!?।॥])${sendCommand}(?:[\\s,;:.!?।॥]+${sendCommand})*[\\s,;:.!?।॥]*$`, "iu").exec(normalized);
  return marker ? sanitizeVoiceRequest(normalized.slice(0, marker.index)).replace(/[,;:]+$/u, "").trim() : null;
}

export function voiceInterruptionRequest(text: string): string | null {
  const match = new RegExp(`^${interruptCommand}(?:[\\s,;.!?।॥]+|$)([\\s\\S]*)$`, "iu").exec(text.normalize("NFKC").trim());
  return match ? match[1].trim() : null;
}

export function prepareSpokenText(text: string): string {
  return text.replace(new RegExp(`(^|[\\s,;.!?।॥])${interruptCommand}(?=$|[\\s,;.!?।॥])`, "giu"), "$1Navigator")
    .replace(new RegExp(`(^|[\\s,;:.!?।॥])${discardCommand}(?=$|[\\s,;:.!?।॥])`, "giu"), "$1the deletion cue")
    .replace(new RegExp(`(^|[\\s,;:.!?।॥])${sendCommand}(?=$|[\\s,;:.!?।॥])`, "giu"), (match, prefix: string) => `${prefix}${/[\u0900-\u097f]/u.test(match) ? "भेजने का संकेत" : "the submission cue"}`);
}

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
interface BrowserRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(audioTrack?: MediaStreamTrack): void;
  abort(): void;
}
type VoiceWindow = Window & {
  SpeechRecognition?: new () => BrowserRecognition;
  webkitSpeechRecognition?: new () => BrowserRecognition;
};

export function recognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  const browser = window as VoiceWindow;
  return !!(browser.SpeechRecognition || browser.webkitSpeechRecognition);
}

export function startRecognition(callbacks: {
  onStart?: () => void;
  onResult?: () => void;
  onTranscript: (text: string, final: boolean) => void;
  onError: (reason: RecognitionError) => void;
  onEnd: () => void;
  onComplete?: (text: string) => void;
  onDiscard?: () => void;
  keepAlive?: boolean;
  maxDurationMs?: number;
  startDelayMs?: number;
  language?: string;
  audioTrack?: MediaStreamTrack;
  initialTranscript?: string;
  acceptTranscript?: (text: string, final: boolean) => boolean;
  ignoreTranscript?: (text: string) => boolean;
  retainRejectedTranscript?: (text: string) => boolean;
}): () => void {
  const browser = window as VoiceWindow;
  const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition;
  if (!Constructor) { callbacks.onError("unsupported"); return () => {}; }
  const recognition = new Constructor();
  recognition.lang = callbacks.language ?? (navigator.language.toLowerCase().startsWith("en") ? navigator.language : "en-US");
  recognition.continuous = true;
  recognition.interimResults = true;
  let ended = false;
  let limit: ReturnType<typeof setTimeout> | undefined;
  let restart: ReturnType<typeof setTimeout> | undefined;
  let prefix = callbacks.initialTranscript?.trim() ?? "";
  let transcript = prefix;
  let finalized = Boolean(prefix);
  let discardedResults = 0;
  const ignoredResults = new Set<number>();
  function resetDraft(results: number) {
    prefix = ""; transcript = ""; finalized = false; discardedResults = results;
    ignoredResults.clear();
  }
  function clearTimers() { clearTimeout(limit); clearTimeout(restart); }
  function detach() { recognition.onstart = null; recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.onspeechstart = null; recognition.onspeechend = null; }
  function startBrowserRecognition() {
    if (callbacks.audioTrack) recognition.start(callbacks.audioTrack);
    else recognition.start();
  }
  function failStartup(error: unknown) {
    if (ended) return;
    ended = true;
    clearTimers(); detach(); recognition.abort();
    const name = error instanceof Error ? error.name : "";
    callbacks.onError(name === "NotAllowedError" || name === "SecurityError" ? "permission"
      : callbacks.audioTrack && (name === "TypeError" || name === "NotSupportedError" || (name === "InvalidStateError" && callbacks.audioTrack.readyState === "ended")) ? "audio-track"
      : name === "InvalidStateError" ? "busy"
      : name === "NotSupportedError" ? "unsupported"
      : name === "NotFoundError" || name === "NotReadableError" ? "audio-capture" : "unknown");
  }
  const finish = () => {
    if (ended) return;
    ended = true;
    clearTimers(); detach(); recognition.abort();
    callbacks.onEnd();
  };
  recognition.onstart = () => { if (!ended) callbacks.onStart?.(); };
  recognition.onresult = (event) => {
    if (ended) return;
    callbacks.onResult?.();
    while (!prefix && callbacks.acceptTranscript && discardedResults < event.results.length) {
      const result = event.results[discardedResults];
      if (!result.isFinal || callbacks.acceptTranscript(result[0].transcript, true) || callbacks.retainRejectedTranscript?.(result[0].transcript)) break;
      discardedResults += 1;
    }
    const segments: string[] = [];
    let final = event.results.length > discardedResults;
    for (let index = discardedResults; index < event.results.length; index += 1) {
      if (ignoredResults.has(index)) continue;
      if (callbacks.ignoreTranscript?.(event.results[index][0].transcript)) {
        if (event.results[index].isFinal) ignoredResults.add(index);
        continue;
      }
      segments.push(event.results[index][0].transcript.trim());
      final &&= event.results[index].isFinal;
    }
    const candidate = [prefix, segments.filter(Boolean).join(" ")].filter(Boolean).join(" ");
    if (callbacks.acceptTranscript && !callbacks.acceptTranscript(candidate, final)) {
      if (callbacks.retainRejectedTranscript?.(candidate)) { transcript = candidate; finalized = final; return; }
      if (final) discardedResults = event.results.length;
      prefix = ""; transcript = ""; finalized = false;
      return;
    }
    transcript = candidate;
    finalized = final;
    if (final && callbacks.onDiscard && new RegExp(`(?:^|[\\s,;:.!?।॥])${discardCommand}(?:[\\s,;:.!?।॥]+${discardCommand})*[\\s,;:.!?।॥]*$`, "iu").test(sanitizeVoiceRequest(transcript))) {
      if (callbacks.keepAlive) resetDraft(event.results.length);
      else finish();
      callbacks.onTranscript("", true);
      callbacks.onDiscard();
      return;
    }
    const completed = final ? voiceRequest(transcript) : null;
    callbacks.onTranscript(completed ?? transcript, final);
    if (ended) return;
    if (completed !== null && callbacks.onComplete) {
      if (callbacks.keepAlive) resetDraft(event.results.length);
      else finish();
      if (completed) callbacks.onComplete(completed);
    }
  };
  recognition.onerror = ({ error }) => {
    if (ended) return;
    if (error === "aborted") return;
    if (error === "no-speech" && callbacks.onComplete) return;
    ended = true;
    clearTimers(); detach(); recognition.abort();
    callbacks.onError(error === "not-allowed" || error === "service-not-allowed" ? "permission"
      : error === "network" ? "network"
      : error === "no-speech" ? "no-speech"
      : error === "audio-capture" ? "audio-capture"
      : error === "language-not-supported" ? "language" : "unknown");
  };
  recognition.onend = () => {
    if (ended) return;
    if (!callbacks.onComplete || (!callbacks.keepAlive && !finalized && transcript.trim())) { finish(); return; }
    prefix = transcript;
    discardedResults = 0;
    ignoredResults.clear();
    restart = setTimeout(() => {
      if (ended) return;
      try { startBrowserRecognition(); } catch (error) { failStartup(error); }
    }, 150);
  };
  function begin() {
    if (ended) return;
    try {
      startBrowserRecognition();
      if (!callbacks.keepAlive) limit = setTimeout(finish, Math.min(90000, callbacks.maxDurationMs ?? 90000));
    } catch (error) { failStartup(error); }
  }
  const delay = Math.min(500, Math.max(0, callbacks.startDelayMs ?? 0));
  if (delay) restart = setTimeout(begin, delay);
  else begin();
  return () => {
    ended = true;
    clearTimers(); detach();
    recognition.abort();
  };
}

export const recognitionMessages: Record<RecognitionError, string> = {
  permission: "Microphone permission was denied. Allow it in your browser settings, or type your question.",
  unsupported: "Speech recognition is not available in this browser. You can type your question.",
  network: "The browser speech service could not connect. Please type your question.",
  "no-speech": "No speech was detected. Try again or type your question.",
  "audio-track": "The browser rejected speech recognition from the echo-cancelled microphone track. Update your browser; meanwhile, turn off Allow interruptions and use the microphone button to stop playback and speak.",
  "audio-capture": "The browser could not access a working microphone. Check the selected input device and Windows microphone access, then try again.",
  language: "The browser speech service does not support the selected recognition language. Try another language or type your question.",
  busy: "Speech recognition is already running. Stop voice input before starting the microphone again.",
  unknown: "Voice input could not start. Check your microphone or type your question.",
};

export function startVoiceInterruption(callbacks: {
  spokenText?: string;
  getSpokenText?: () => string;
  playbackActive?: () => boolean;
  getOptionCount?: () => number;
  initialTranscript?: string;
  language?: string;
  audioTrack?: MediaStreamTrack;
  keepAlive?: boolean;
  optionCount?: number;
  onReady?: () => void;
  onResult?: () => void;
  onSpeech: (text: string) => void;
  onTranscript?: (text: string, final: boolean) => void;
  onComplete?: (text: string) => void;
  onDiscard?: () => void;
  onEnd?: () => void;
  onError: (message: string) => void;
}): () => void {
  const numbers: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", "एक": "1", "दो": "2", "तीन": "3", "चार": "4", "पाँच": "5", "पांच": "5" };
  const speechWords = (text: string) => (text.normalize("NFKC").toLowerCase().replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966)).match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map((word) => Object.hasOwn(numbers, word) ? numbers[word] : word);
  let spokenText = "";
  let playbackWords: string[] = [];
  let playback = " ";
  let playbackVocabulary = new Set<string>();
  function refreshPlayback() {
    const current = callbacks.getSpokenText?.() ?? callbacks.spokenText ?? "";
    if (current === spokenText) return;
    spokenText = current;
    playbackWords = speechWords(current);
    playback = ` ${playbackWords.join(" ")} `;
    playbackVocabulary = new Set(playbackWords);
  }
  function isPlayback(text: string): boolean {
    if (callbacks.playbackActive && !callbacks.playbackActive()) return false;
    refreshPlayback();
    const words = speechWords(text);
    return words.length > 0 && (playback.includes(` ${words.join(" ")} `) || (words.length >= 8 && words.filter((word) => playbackVocabulary.has(word)).length / words.length >= 0.85));
  }
  function isPlaybackPrefix(text: string): boolean {
    refreshPlayback();
    const words = speechWords(text);
    return words.length >= 3 && playback.includes(` ${words.join(" ")} `);
  }
  function addressedText(text: string): string {
    const clean = sanitizeVoiceRequest(text);
    const marker = /(?:^|[\s,;.!?।॥])(?:hey|हे)(?=$|[\s,;.!?।॥])/iu.exec(clean);
    if (!marker || marker.index === 0) return clean;
    const prefix = clean.slice(0, marker.index);
    return isPlaybackPrefix(prefix) ? clean.slice(marker.index).trim() : clean;
  }
  function optionRequest(text: string, requireControl: boolean): string | null {
    const body = voiceRequest(text);
    if (requireControl && body === null) return null;
    const request = body ?? text;
    const inRange = (index: number | undefined) => index !== undefined && index >= 0 && index < (callbacks.getOptionCount?.() ?? callbacks.optionCount ?? 0);
    if (inRange(lastOptionIndex(request))) return request;
    for (const token of Array.from(request.matchAll(/[\p{L}\p{M}\p{N}]+/gu)).slice(3)) {
      const suffix = request.slice(token.index);
      if (isPlaybackPrefix(request.slice(0, token.index)) && inRange(lastOptionIndex(suffix))) return speechWords(suffix).join(" ");
    }
    return null;
  }
  let interrupted = false;
  let cancelled = false;
  let ready = false;
  let readiness: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  if (callbacks.onReady) readiness = setTimeout(() => {
    if (cancelled || ready) return;
    cancelled = true;
    stop();
    callbacks.onError("The interruption microphone did not become ready. The reply will play without automatic interruption. Use Stop speaking or the microphone button.");
  }, 2500);
  stop = startRecognition({
    language: callbacks.language,
    audioTrack: callbacks.audioTrack,
    keepAlive: callbacks.keepAlive,
    initialTranscript: callbacks.initialTranscript,
    maxDurationMs: 90000,
    onResult: callbacks.onResult,
    onStart: () => {
      if (cancelled || ready) return;
      ready = true;
      clearTimeout(readiness);
      callbacks.onReady?.();
    },
    acceptTranscript: (text) => {
      if (!speechWords(sanitizeVoiceRequest(text)).length) return false;
      return interrupted || !isPlayback(text) || optionRequest(text, true) !== null;
    },
    ignoreTranscript: (text) => isPlayback(text) && optionRequest(text, true) === null,
    onTranscript: (text, final) => {
      if (cancelled) return;
      const request = voiceInterruptionRequest(addressedText(text)) ?? optionRequest(text, false) ?? sanitizeVoiceRequest(text);
      if (!interrupted) { interrupted = true; callbacks.onSpeech(request); }
      if (!cancelled) callbacks.onTranscript?.(request, final);
    },
    onComplete: (text) => {
      const request = voiceInterruptionRequest(addressedText(text)) ?? optionRequest(text, false) ?? sanitizeVoiceRequest(text);
      if (!cancelled && interrupted && request?.trim()) callbacks.onComplete?.(request);
      interrupted = false;
    },
    onDiscard: () => { interrupted = false; if (!cancelled) callbacks.onDiscard?.(); },
    onEnd: () => {
      clearTimeout(readiness);
      if (cancelled) return;
      if (interrupted) callbacks.onEnd?.();
      else callbacks.onError("Automatic interruption listening ended without confirmed speech. Use the microphone button or enable Allow interruptions again.");
    },
    onError: (reason) => {
      clearTimeout(readiness);
      if (cancelled) return;
      cancelled = true;
      callbacks.onError(`Automatic interruption listening stopped. ${recognitionMessages[reason]} Use Stop speaking or the microphone button instead.`);
    },
  });
  return () => { cancelled = true; clearTimeout(readiness); stop(); };
}

export function startMicrophoneInterruption(callbacks: Parameters<typeof startVoiceInterruption>[0] & {
  onCaptureFallback?: (message: string) => void;
}): () => void {
  let cancelled = false;
  let fallbackStarted = false;
  let captureDeadline: ReturnType<typeof setTimeout> | undefined;
  let stream: MediaStream | undefined;
  let stop = () => {};
  const release = () => {
    clearTimeout(captureDeadline);
    const microphone = stream;
    stream = undefined;
    microphone?.getTracks().forEach((track) => track.stop());
  };
  const fail = (message: string) => {
    if (cancelled) return;
    cancelled = true;
    stop();
    release();
    callbacks.onError(message);
  };
  function useBrowserMicrophone() {
    if (cancelled || fallbackStarted) return;
    fallbackStarted = true;
    stop();
    release();
    callbacks.onCaptureFallback?.("Using browser microphone compatibility mode because processed-track recognition was unavailable or returned no words. Continuous listening remains enabled; Nova's speaker audio may still be picked up. Headphones are recommended.");
    if (cancelled) return;
    stop = startVoiceInterruption({
      ...callbacks,
      audioTrack: undefined,
      onError: fail,
    });
    if (cancelled) stop();
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    useBrowserMicrophone();
  } else {
    const audioConstraints = {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
    } satisfies MediaTrackConstraints;
    void navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false,
    }).then(async (microphone) => {
      stream = microphone;
      if (cancelled) { release(); return; }
      const audioTrack = microphone.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== "live") {
        fail("No live microphone was found. Check your microphone selection and permission, then enable Allow interruptions again.");
        return;
      }
      const modes: readonly unknown[] | undefined = audioTrack.getCapabilities?.().echoCancellation;
      if (modes?.includes("all")) {
        try {
          await audioTrack.applyConstraints({
            ...audioConstraints,
            echoCancellation: { exact: "all" } as unknown as MediaTrackConstraints["echoCancellation"],
          });
        } catch (error: unknown) {
          if (!(error instanceof DOMException) || !["OverconstrainedError", "NotSupportedError"].includes(error.name)) throw error;
        }
      }
      if (cancelled) { release(); return; }
      const cancellation: unknown = audioTrack?.getSettings().echoCancellation;
      if (cancellation !== "all" && cancellation !== true) {
        useBrowserMicrophone();
        return;
      }
      let receivedResult = false;
      const stopTrackRecognition = startVoiceInterruption({
        ...callbacks,
        audioTrack,
        onResult: () => {
          receivedResult = true;
          clearTimeout(captureDeadline);
          callbacks.onResult?.();
        },
        onEnd: () => { release(); callbacks.onEnd?.(); },
        onError: useBrowserMicrophone,
      });
      if (cancelled || fallbackStarted) { stopTrackRecognition(); return; }
      stop = stopTrackRecognition;
      if (!receivedResult) captureDeadline = setTimeout(useBrowserMicrophone, 6000);
    }).catch((error: unknown) => {
      if (error instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(error.name)) fail(recognitionMessages.permission);
      else useBrowserMicrophone();
    });
  }
  return () => { cancelled = true; stop(); release(); };
}

export function speakResponse(text: string, onEnd: () => void, onError?: (message: string) => void, language?: string): () => void {
  if (!("speechSynthesis" in window)) { onError?.("Spoken replies are not available in this browser. You can read the reply as text."); onEnd(); return () => {}; }
  const synthesis = window.speechSynthesis;
  synthesis.cancel();
  const preferredLanguage = /[\u0900-\u097f]/u.test(text) ? "hi-IN" : language ?? (navigator.language.toLowerCase().startsWith("en") ? navigator.language : "en-US");
  const languageFamily = preferredLanguage.split("-")[0].toLowerCase();
  const safeText = prepareSpokenText(text);
  const sentences = typeof Intl.Segmenter === "function" ? Array.from(new Intl.Segmenter(preferredLanguage, { granularity: "sentence" }).segment(safeText), (part) => part.segment) : [safeText];
  const segments: string[] = [];
  for (const sentence of sentences) {
    let chunk = "";
    for (const word of sentence.trim().split(/\s+/).filter(Boolean)) {
      if (chunk && chunk.length + word.length + 1 > 180) { segments.push(chunk); chunk = ""; }
      chunk = chunk ? `${chunk} ${word}` : word;
    }
    if (chunk) segments.push(chunk);
  }
  let cancelled = false;
  let current: SpeechSynthesisUtterance | null = null;
  let index = 0;
  function speakNext() {
    if (cancelled) return;
    if (index >= segments.length) { cancelled = true; onEnd(); return; }
    const utterance = new SpeechSynthesisUtterance(segments[index++]);
    current = utterance;
    const voices = synthesis.getVoices();
    const voice = voices.find((item) => item.lang.toLowerCase() === preferredLanguage.toLowerCase() && item.localService)
      ?? voices.find((item) => item.lang.toLowerCase() === preferredLanguage.toLowerCase())
      ?? voices.find((item) => item.lang.toLowerCase().split("-")[0] === languageFamily);
    if (languageFamily === "hi" && voices.length > 0 && !voice) {
      cancelled = true;
      onError?.("Hindi speech is not installed on this device. Enable a Hindi voice in your browser or device speech settings. The reply is available as text.");
      onEnd();
      return;
    }
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? preferredLanguage;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = speakNext;
    utterance.onerror = (event) => {
      if (cancelled) return;
      cancelled = true;
      if (event.error !== "canceled" && event.error !== "interrupted") onError?.("Audio playback failed. Check your browser audio settings; the reply is available as text and can be replayed.");
      onEnd();
    };
    synthesis.resume();
    synthesis.speak(utterance);
  }
  speakNext();
  return () => {
    cancelled = true;
    if (current) { current.onend = null; current.onerror = null; }
    synthesis.cancel();
  };
}