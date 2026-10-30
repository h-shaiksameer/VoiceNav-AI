"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AudioLines, Check, ChevronDown, ChevronUp, LoaderCircle, Mic, MicOff, Send, Square, Volume2, X } from "lucide-react";
import type { ConversationEngine } from "@/conversation/ConversationEngine";
import { HINDI_VOICE_SEND_PHRASE, prepareSpokenText, recognitionMessages, recognitionSupported, speakResponse, startMicrophoneInterruption, startRecognition, VOICE_SEND_PHRASE } from "@/services/voice/browserVoice";

type VoiceState = "idle" | "listening" | "processing" | "responding" | "error";
const subscribeCapabilities = () => () => {};
const serverRecognition = () => false;

export function VoiceAssistant({ engine, blocked, onBusyChange }: { engine: ConversationEngine; blocked: boolean; onBusyChange: (busy: boolean) => void }) {
  const context = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const voiceSupported = useSyncExternalStore(subscribeCapabilities, recognitionSupported, serverRecognition);
  const [state, setState] = useState<VoiceState>("idle");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [spoken, setSpoken] = useState(true);
  const [allowInterruptions, setAllowInterruptions] = useState(false);
  const [interruptionReady, setInterruptionReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const abortListening = useRef<(() => void) | null>(null);
  const stopSpeaking = useRef<(() => void) | null>(null);
  const stopInterruption = useRef<(() => void) | null>(null);
  const interruptionEnabled = useRef(false);
  const microphoneReady = useRef(false);
  const liveDraft = useRef("");
  const queuedVoiceRequests = useRef<string[]>([]);
  const replyActive = useRef(false);
  const panelOpen = useRef(true);
  const currentSpokenText = useRef("");
  const pendingPlayback = useRef<(() => void) | null>(null);
  const playbackStoppedAt = useRef(0);
  const messages = useRef<HTMLDivElement>(null);
  const speechEnabled = useRef(true);
  const beforeListening = useRef("");
  const requestActive = useRef(false);
  const voiceConversation = useRef(false);
  const resumeListening = useRef<(followup?: boolean) => void>(() => {});
  const resumeSubmission = useRef<(text: string) => void>(() => {});
  const status = state === "idle" && blocked ? "processing" : state;
  const processing = state === "processing" || state === "responding";
  const sendPhrase = context.language === "hi" ? HINDI_VOICE_SEND_PHRASE : VOICE_SEND_PHRASE;
  const statusLabel = status === "listening"
    ? allowInterruptions && !interruptionReady ? "Starting microphone" : `Listening · ${sendPhrase} / Discard`
    : status === "responding" && allowInterruptions ? interruptionReady ? "Speaking · Interruptible" : "Starting microphone"
    : status === "idle" && input.trim() ? "Draft ready" : status.charAt(0).toUpperCase() + status.slice(1);

  useEffect(() => {
    panelOpen.current = true;
    return () => {
      panelOpen.current = false;
      interruptionEnabled.current = false;
      microphoneReady.current = false;
      queuedVoiceRequests.current = [];
      replyActive.current = false;
      pendingPlayback.current = null;
      stopInterruption.current?.(); stopInterruption.current = null;
      abortListening.current?.(); abortListening.current = null;
      stopSpeaking.current?.(); stopSpeaking.current = null;
    };
  }, []);
  useEffect(() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight; }, [context.messages, collapsed]);
  useEffect(() => {
    function stopHiddenRecording() {
      if (!document.hidden) return;
      interruptionEnabled.current = false;
      microphoneReady.current = false;
      queuedVoiceRequests.current = [];
      setAllowInterruptions(false);
      const active = replyActive.current || Boolean(abortListening.current) || Boolean(stopSpeaking.current);
      voiceConversation.current = false;
      replyActive.current = false;
      pendingPlayback.current = null;
      setInterruptionReady(false);
      stopInterruption.current?.(); stopInterruption.current = null;
      if (!active) return;
      abortListening.current?.(); abortListening.current = null;
      if (stopSpeaking.current) playbackStoppedAt.current = Date.now();
      stopSpeaking.current?.(); stopSpeaking.current = null;
      setState((current) => current === "listening" || current === "responding" ? "idle" : current);
      onBusyChange(false);
    }
    document.addEventListener("visibilitychange", stopHiddenRecording);
    return () => document.removeEventListener("visibilitychange", stopHiddenRecording);
  }, [onBusyChange]);

  function stopVoice() {
    microphoneReady.current = false;
    voiceConversation.current = false;
    replyActive.current = false;
    pendingPlayback.current = null;
    setInterruptionReady(false);
    stopInterruption.current?.(); stopInterruption.current = null;
    abortListening.current?.(); abortListening.current = null;
    if (stopSpeaking.current) playbackStoppedAt.current = Date.now();
    stopSpeaking.current?.(); stopSpeaking.current = null;
    setState("idle");
    onBusyChange(false);
    if (interruptionEnabled.current && panelOpen.current && !document.hidden) armInterruption();
  }

  function finishReply() {
    playbackStoppedAt.current = Date.now();
    replyActive.current = false;
    pendingPlayback.current = null;
    stopSpeaking.current = null;
    if (interruptionEnabled.current && panelOpen.current && !document.hidden) {
      voiceConversation.current = true;
      setState("listening"); onBusyChange(false);
      armInterruption();
      return;
    }
    setInterruptionReady(false);
    stopInterruption.current?.(); stopInterruption.current = null;
    setState("idle"); onBusyChange(false);
    const pending = engine.getSnapshot();
    if (voiceConversation.current && !document.hidden && (pending.pendingDestination || pending.pendingLocationChoices.length)) resumeListening.current();
    else voiceConversation.current = false;
  }

  function armInterruption() {
    if (!interruptionEnabled.current || !voiceSupported || !panelOpen.current || document.hidden) { pendingPlayback.current?.(); return; }
    if (stopInterruption.current) {
      if (microphoneReady.current) pendingPlayback.current?.();
      return;
    }
    abortListening.current?.(); abortListening.current = null;
    microphoneReady.current = false;
    setInterruptionReady(false);
    voiceConversation.current = true;
    if (!replyActive.current && !requestActive.current) { setState("listening"); onBusyChange(false); }
    stopInterruption.current = startMicrophoneInterruption({
      getSpokenText: () => currentSpokenText.current,
      playbackActive: () => replyActive.current || Date.now() - playbackStoppedAt.current < 400,
      getOptionCount: () => engine.getSnapshot().pendingLocationChoices.length,
      initialTranscript: liveDraft.current,
      keepAlive: true,
      language: engine.getSnapshot().language === "hi" ? "hi-IN" : "en-IN",
      onCaptureFallback: (message) => {
        microphoneReady.current = false;
        setInterruptionReady(false);
        setError(message);
      },
      onReady: () => {
        if (!interruptionEnabled.current || !panelOpen.current || document.hidden) return;
        microphoneReady.current = true;
        setInterruptionReady(true);
        pendingPlayback.current?.();
      },
      onSpeech: interruptReply,
      onTranscript: (text) => {
        liveDraft.current = text;
        setInput(text.slice(0, 500));
        if (text.trim()) interruptReply();
      },
      onComplete: (text) => { liveDraft.current = ""; setInput(""); resumeSubmission.current(text); },
      onDiscard: () => { liveDraft.current = ""; beforeListening.current = ""; setInput(""); },
      onEnd: () => {
        microphoneReady.current = false;
        stopInterruption.current = null;
        interruptionEnabled.current = false;
        setAllowInterruptions(false); setInterruptionReady(false);
        setError("Continuous listening ended. Enable Allow interruptions to listen again.");
        if (!replyActive.current && !requestActive.current) { setState("idle"); onBusyChange(false); }
      },
      onError: (message) => {
        stopInterruption.current = null;
        abortListening.current = null;
        interruptionEnabled.current = false;
        microphoneReady.current = false;
        queuedVoiceRequests.current = [];
        setInterruptionReady(false);
        setAllowInterruptions(false);
        setError(message);
        if (replyActive.current) pendingPlayback.current?.();
        else if (!requestActive.current) { voiceConversation.current = false; setState("error"); onBusyChange(false); }
      },
    });
  }

  function interruptReply() {
    if (!interruptionEnabled.current || !panelOpen.current || document.hidden) return;
    if (replyActive.current) {
      replyActive.current = false;
      pendingPlayback.current = null;
      playbackStoppedAt.current = Date.now();
      stopSpeaking.current?.(); stopSpeaking.current = null;
    }
    if (!requestActive.current) { setError(""); setState("listening"); onBusyChange(false); }
  }

  function playReply(text: string, spokenText = engine.getSpokenText(text)) {
    replyActive.current = false;
    pendingPlayback.current = null;
    if (!interruptionEnabled.current) {
      setInterruptionReady(false);
      stopInterruption.current?.(); stopInterruption.current = null;
    }
    abortListening.current?.(); abortListening.current = null;
    stopSpeaking.current?.(); stopSpeaking.current = null;
    if (!panelOpen.current || document.hidden) { voiceConversation.current = false; finishReply(); return; }
    setError(""); setState("responding"); onBusyChange(true);
    replyActive.current = true;
    currentSpokenText.current = prepareSpokenText(engine.getSpokenText(spokenText));
    const language = /[\u0900-\u097f]/u.test(text) ? "hi-IN" : "en-IN";
    let started = false;
    pendingPlayback.current = () => {
      if (started || !replyActive.current || !panelOpen.current || document.hidden) return;
      started = true;
      pendingPlayback.current = null;
      stopSpeaking.current = speakResponse(currentSpokenText.current, finishReply, (message) => { voiceConversation.current = false; setError(message); }, language);
    };
    if (interruptionEnabled.current) armInterruption();
    else pendingPlayback.current();
  }

  async function run(action: () => Promise<string>) {
    if (requestActive.current) return;
    requestActive.current = true;
    replyActive.current = false;
    pendingPlayback.current = null;
    if (!interruptionEnabled.current) {
      setInterruptionReady(false);
      stopInterruption.current?.(); stopInterruption.current = null;
    }
    abortListening.current?.(); abortListening.current = null;
    stopSpeaking.current?.(); stopSpeaking.current = null;
    setError(""); setState("processing"); onBusyChange(true);
    if (interruptionEnabled.current) armInterruption();
    try {
      const response = await action();
      if (speechEnabled.current && response) {
        const latest = engine.getSnapshot().messages.at(-1);
        playReply(response, latest?.role === "assistant" && latest.text === response ? latest.spokenText : undefined);
      } else { finishReply(); }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to process this request.";
      voiceConversation.current = false;
      if (speechEnabled.current) { playReply(message); setError(message); }
      else { setError(message); setState("error"); onBusyChange(false); }
    } finally { requestActive.current = false; }
  }

  async function submit(text: string, fromVoice = false) {
    if (!text.trim()) return;
    if (requestActive.current || blocked) {
      if (fromVoice && interruptionEnabled.current) { queuedVoiceRequests.current.push(text); setInput(""); }
      return;
    }
    if (processing && !fromVoice) return;
    if (!fromVoice && interruptionEnabled.current) {
      stopInterruption.current?.(); stopInterruption.current = null;
      microphoneReady.current = false;
    }
    voiceConversation.current = fromVoice;
    liveDraft.current = "";
    setInput("");
    await run(() => engine.send(text));
  }

  function listen(followup = false) {
    if (!followup && state === "listening") { stopVoice(); return; }
    if (blocked || (state === "processing" && !followup) || !panelOpen.current || document.hidden) return;
    if (interruptionEnabled.current) { interruptReply(); armInterruption(); return; }
    if (replyActive.current) playbackStoppedAt.current = Date.now();
    voiceConversation.current = true;
    replyActive.current = false;
    pendingPlayback.current = null;
    setInterruptionReady(false);
    stopInterruption.current?.(); stopInterruption.current = null;
    abortListening.current?.(); abortListening.current = null;
    stopSpeaking.current?.(); stopSpeaking.current = null;
    setError(""); setState("listening"); onBusyChange(true);
    beforeListening.current = followup ? "" : input.trim();
    abortListening.current = startRecognition({
      language: engine.getSnapshot().language === "hi" ? "hi-IN" : "en-IN",
      startDelayMs: Date.now() - playbackStoppedAt.current < 400 ? 400 : 0,
      initialTranscript: beforeListening.current,
      onTranscript: (text) => {
        liveDraft.current = text;
        setInput(text.slice(0, 500));
      },
      onComplete: (text) => { void submit(text, true); },
      onDiscard: () => { liveDraft.current = ""; beforeListening.current = ""; setInput(""); },
      maxDurationMs: followup ? 15000 : 90000,
      onError: (reason) => { voiceConversation.current = false; setError(recognitionMessages[reason]); setState("error"); onBusyChange(false); },
      onEnd: () => { voiceConversation.current = false; abortListening.current = null; setState((current) => current === "listening" ? "idle" : current); onBusyChange(false); },
    });
  }

  function setContinuousListening(enabled: boolean) {
    setAllowInterruptions(enabled);
    interruptionEnabled.current = enabled;
    if (enabled) { setError(""); armInterruption(); return; }
    stopInterruption.current?.(); stopInterruption.current = null;
    microphoneReady.current = false;
    queuedVoiceRequests.current = [];
    setInterruptionReady(false);
    if (!replyActive.current && !requestActive.current) { setState(abortListening.current ? "listening" : "idle"); onBusyChange(Boolean(abortListening.current)); }
    pendingPlayback.current?.();
  }

  useEffect(() => {
    resumeListening.current = (followup = true) => listen(followup);
    resumeSubmission.current = (text) => { void submit(text, true); };
    if (!blocked && !requestActive.current && interruptionEnabled.current && panelOpen.current && !document.hidden && queuedVoiceRequests.current.length) {
      const queued = queuedVoiceRequests.current.shift();
      if (queued) void submit(queued, true);
    }
  });

  return <section className={`assistant-panel ${collapsed ? "assistant-collapsed" : ""}`} aria-labelledby="assistant-title">
    <header className="assistant-header"><span className={`assistant-symbol ${state === "listening" ? "listening" : ""}`}><AudioLines size={21} /></span><div><h2 id="assistant-title">VoiceNav assistant</h2><span className={`assistant-status state-${status}`}><i />{statusLabel}</span></div><button className="icon-button" onClick={() => { panelOpen.current = collapsed; if (!collapsed) { voiceConversation.current = false; setContinuousListening(false); if (state === "listening" || state === "responding") stopVoice(); } setCollapsed(!collapsed); }} aria-expanded={!collapsed} aria-label={collapsed ? "Expand assistant" : "Collapse assistant"} title={collapsed ? "Expand assistant" : "Collapse assistant"}>{collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button></header>
    {!collapsed && <>
      <div className="conversation" ref={messages} role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
        {context.messages.length === 0 ? <div className="conversation-empty"><AudioLines size={29} /><span>Your journey, in conversation.</span></div> : context.messages.map((message) => <div key={message.id} className={`message message-${message.role}`}><span className="message-role">{message.role === "assistant" ? "VoiceNav · Local" : "You"}{message.role === "assistant" && <button className="icon-button" type="button" title="Read this reply aloud" aria-label="Read this reply aloud" onClick={() => playReply(message.text, message.spokenText)} disabled={blocked || state === "processing"}><Volume2 size={13} /></button>}</span><p>{message.text}</p></div>)}
        {state === "processing" && <div className="thinking"><LoaderCircle size={13} className="spin" /> Processing request</div>}
      </div>
      {context.pendingLocationChoices.length > 0 && <div className="confirmation"><span>Destination matches</span><ol className="address-results">{context.pendingLocationChoices.map((location, index) => <li key={location.id}><button type="button" disabled={blocked || state === "processing"} onClick={() => void run(() => engine.chooseLocation(index))}>Option {index + 1}: {location.name}</button></li>)}</ol></div>}
      {context.pendingDestination && <div className="confirmation"><span>{context.pendingOrigin ? "New route" : "Destination change"}</span>{context.pendingOrigin && <p>From {context.pendingOrigin.name}</p>}<strong>{context.pendingDestination.name}</strong><div><button className="primary-button" disabled={blocked || processing} onClick={() => void run(() => engine.confirm())}><Check size={14} />{context.pendingOrigin ? "Confirm route" : "Confirm destination"}</button><button className="secondary-button" disabled={blocked || processing} onClick={() => engine.cancel()}><X size={14} />Cancel</button></div></div>}
      {error && <p className="voice-error" role="alert">{error}</p>}
      {!voiceSupported && <p className="voice-unavailable"><MicOff size={12} />Voice input unavailable. Text input is ready.</p>}
      <form className="assistant-form" onSubmit={(event) => { event.preventDefault(); void submit(input); }}>
        <label className="sr-only" htmlFor="assistant-message">Message the navigation assistant</label>
        <textarea id="assistant-message" lang={context.language === "hi" ? "hi" : "en"} placeholder={context.language === "hi" ? "अपनी मंज़िल या रास्ते के बारे में पूछिए…" : "Ask about your journey…"} rows={2} maxLength={500} value={input} onChange={(event) => { liveDraft.current = event.target.value; if (state === "listening") stopVoice(); setInput(event.target.value); }} disabled={processing || blocked} autoComplete="off" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(input); } }} />
        <button type="button" className={`mic-button ${state === "listening" ? "active" : ""}`} title={state === "listening" ? "Stop recording and keep draft" : state === "responding" ? "Interrupt reply and listen" : "Start voice input"} aria-label={state === "listening" ? "Stop recording and keep draft" : state === "responding" ? "Interrupt reply and listen" : "Start voice input"} aria-pressed={state === "listening"} onClick={() => listen()} disabled={!voiceSupported || state === "processing" || blocked}>{state === "listening" ? <Square size={16} /> : <Mic size={18} />}</button>
        {state === "listening" && <button className="icon-button" type="button" title="Cancel voice draft" aria-label="Cancel voice draft" onClick={() => { if (interruptionEnabled.current) { stopInterruption.current?.(); stopInterruption.current = null; microphoneReady.current = false; liveDraft.current = ""; beforeListening.current = ""; setInput(""); armInterruption(); } else { stopVoice(); liveDraft.current = beforeListening.current; setInput(beforeListening.current); } }}><X size={15} /></button>}
        {state === "responding" ? <button className="icon-button" type="button" title="Stop speaking" aria-label="Stop speaking" onClick={stopVoice}><Square size={16} /></button> : <button className="send-button" type="submit" title={state === "listening" ? "Finish recording and send" : "Send message"} aria-label={state === "listening" ? "Finish recording and send" : "Send message"} disabled={!input.trim() || processing || blocked}>{state === "processing" ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}</button>}
      </form>
      <footer className="assistant-footer"><label htmlFor="assistant-language">Language<select id="assistant-language" value={context.language} disabled={blocked || state !== "idle" && state !== "error"} onChange={(event) => { engine.setLanguage(event.target.value === "hi" ? "hi" : "en"); stopVoice(); }}><option value="en">English</option><option value="hi">हिन्दी / Deccani</option></select></label><label title="Spoken replies"><Volume2 size={12} /><span>Spoken replies</span><input type="checkbox" checked={spoken} onChange={(event) => { const enabled = event.target.checked; setSpoken(enabled); speechEnabled.current = enabled; if (!enabled && replyActive.current) { playbackStoppedAt.current = Date.now(); stopSpeaking.current?.(); stopSpeaking.current = null; finishReply(); } }} /></label></footer>
      <footer className="assistant-footer"><label title={`Keep listening between replies and interrupt without a wake phrase. Finish with ${sendPhrase} or Submit to submit, or Discard to clear the draft. The microphone and playback buttons do not disable this setting. Uncheck to stop automatic listening; hiding the page or collapsing the panel also stops it. Uses an echo-cancelled microphone; browser support varies.`}><Mic size={12} /><span>Allow interruptions</span><input type="checkbox" checked={allowInterruptions} disabled={!voiceSupported} onChange={(event) => setContinuousListening(event.target.checked)} /></label></footer>
    </>}
  </section>;
}