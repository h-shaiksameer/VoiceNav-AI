"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Check, ChevronDown, ChevronUp, Layers, LoaderCircle, Mic, MicOff, Send, Square, Volume2, X } from "lucide-react";
import type { ConversationEngine } from "@/conversation/ConversationEngine";
import { lastOptionIndex } from "@/navigation/commands";
import { HINDI_VOICE_SEND_PHRASE, prepareSpokenText, recognitionMessages, recognitionSupported, speakResponse, startMicrophoneInterruption, startRecognition, VOICE_SEND_PHRASE } from "@/services/voice/browserVoice";

type VoiceState = "idle" | "listening" | "processing" | "responding" | "error";
const subscribeCapabilities = () => () => {};
const serverRecognition = () => false;
let microphoneOwner: symbol | null = null;

function claimMicrophone(owner: symbol): boolean {
  if (microphoneOwner && microphoneOwner !== owner) return false;
  microphoneOwner = owner;
  return true;
}

function releaseMicrophone(owner: symbol): void {
  if (microphoneOwner === owner) microphoneOwner = null;
}

export function VoiceAssistant({ engine, blocked, onBusyChange, active = true }: { engine: ConversationEngine; blocked: boolean; onBusyChange: (busy: boolean) => void; active?: boolean }) {
  const context = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const voiceSupported = useSyncExternalStore(subscribeCapabilities, recognitionSupported, serverRecognition);
  const [state, setState] = useState<VoiceState>("idle");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [spoken, setSpoken] = useState(true);
  const [microphoneIdentity] = useState(() => Symbol("voice-workspace"));
  const [allowInterruptions, setAllowInterruptions] = useState(false);
  const [uiControlActive, setUiControlActive] = useState(false);
  const [mapVoiceTranscript, setMapVoiceTranscript] = useState("");
  const [interruptionReady, setInterruptionReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileAssistantHidden, setMobileAssistantHidden] = useState(true);
  const uiControlHost = active && typeof document !== "undefined" ? document.getElementById("ui-control-slot") : null;
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
  const uiControlMode = useRef(false);
  const uiRestartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapAutoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionAutoSubmit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidOptionAttempts = useRef(0);
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
      uiControlMode.current = false;
      replyActive.current = false;
      pendingPlayback.current = null;
      stopInterruption.current?.(); stopInterruption.current = null;
      abortListening.current?.(); abortListening.current = null;
      stopSpeaking.current?.(); stopSpeaking.current = null;
      if (optionAutoSubmit.current) clearTimeout(optionAutoSubmit.current);
      if (uiRestartTimer.current) clearTimeout(uiRestartTimer.current);
      if (mapAutoSubmitTimer.current) clearTimeout(mapAutoSubmitTimer.current);
      releaseMicrophone(microphoneIdentity);
    };
  }, [microphoneIdentity]);
  useEffect(() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight; }, [context.messages, collapsed]);
  useEffect(() => {
    function stopHiddenRecording() {
      if (!document.hidden) return;
      interruptionEnabled.current = false;
      microphoneReady.current = false;
      queuedVoiceRequests.current = [];
      releaseMicrophone(microphoneIdentity);
      setAllowInterruptions(false);
      const active = replyActive.current || Boolean(abortListening.current) || Boolean(stopSpeaking.current);
      voiceConversation.current = false;
      setInterruptionReady(false);
      stopInterruption.current?.(); stopInterruption.current = null;
      abortListening.current?.(); abortListening.current = null;
      if (replyActive.current || stopSpeaking.current) {
        setState("responding");
        onBusyChange(true);
      } else if (active) {
        pendingPlayback.current = null;
        setState((current) => current === "listening" || current === "responding" ? "idle" : current);
        onBusyChange(false);
      }
    }
    document.addEventListener("visibilitychange", stopHiddenRecording);
    return () => document.removeEventListener("visibilitychange", stopHiddenRecording);
  }, [microphoneIdentity, onBusyChange]);

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
    releaseMicrophone(microphoneIdentity);
    if (interruptionEnabled.current && panelOpen.current && !document.hidden) armInterruption();
  }

  function finishReply() {
    playbackStoppedAt.current = Date.now();
    replyActive.current = false;
    pendingPlayback.current = null;
    stopSpeaking.current = null;
    if (uiControlMode.current) {
      if (!document.hidden) {
        setUiControlActive(true);
        setState("idle");
        onBusyChange(false);
        listen(true);
        return;
      }
      uiControlMode.current = false;
      setUiControlActive(false);
      setState("idle");
      onBusyChange(false);
      return;
    }
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
    if (!pending.pendingLocationChoices.length) invalidOptionAttempts.current = 0;
    if (voiceConversation.current && !document.hidden && (pending.pendingDestination || pending.pendingLocationChoices.length)) resumeListening.current();
    else voiceConversation.current = false;
  }

  function armInterruption() {
    if (!interruptionEnabled.current || !voiceSupported || !panelOpen.current || document.hidden) { pendingPlayback.current?.(); return; }
    if (!claimMicrophone(microphoneIdentity)) {
      interruptionEnabled.current = false;
      setAllowInterruptions(false);
      setInterruptionReady(false);
      setError("Another workspace is using the microphone. Stop it there before enabling voice here.");
      pendingPlayback.current?.();
      return;
    }
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
      onCaptureFallback: () => {
        microphoneReady.current = false;
        setInterruptionReady(false);
        setError("");
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
        releaseMicrophone(microphoneIdentity);
        microphoneReady.current = false;
        stopInterruption.current = null;
        interruptionEnabled.current = false;
        setAllowInterruptions(false); setInterruptionReady(false);
        setError("Continuous listening ended. Enable Allow interruptions to listen again.");
        if (!replyActive.current && !requestActive.current) { setState("idle"); onBusyChange(false); }
      },
      onError: (message) => {
        releaseMicrophone(microphoneIdentity);
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
    if (!panelOpen.current) { voiceConversation.current = false; finishReply(); return; }
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
    if (microphoneOwner && microphoneOwner !== microphoneIdentity) {
      setError("Another workspace is using the microphone. Stop it there before speaking to Nova here.");
      return;
    }
    if (requestActive.current || blocked) {
      if (fromVoice && interruptionEnabled.current) { queuedVoiceRequests.current.push(text); setInput(""); }
      return;
    }
    if (engine.getSnapshot().pendingMapAction && !uiControlMode.current) {
      engine.clearUiControl();
      return;
    }
    if (processing && !fromVoice) return;
    const choices = engine.getSnapshot().pendingLocationChoices;
    if (fromVoice && choices.length) {
      const selectedOption = lastOptionIndex(text);
      const validOption = selectedOption !== undefined && selectedOption >= 0 && selectedOption < choices.length;
      if (!validOption) {
        invalidOptionAttempts.current += 1;
        if (invalidOptionAttempts.current >= 3) {
          const response = engine.cancel(
            "I could not match your option twice, so I ignored this route. The microphone is closed. Restart the microphone to start a route.",
            "विकल्प दो बार नहीं मिला, इसलिए यह रास्ता छोड़ दिया है। माइक्रोफोन बंद है। रास्ता शुरू करने के लिए माइक्रोफोन फिर शुरू करें।",
          );
          invalidOptionAttempts.current = 0;
          await run(() => Promise.resolve(response));
          return;
        }
      } else invalidOptionAttempts.current = 0;
    }
    if (!fromVoice && interruptionEnabled.current) {
      stopInterruption.current?.(); stopInterruption.current = null;
      microphoneReady.current = false;
    }
    voiceConversation.current = fromVoice;
    liveDraft.current = "";
    setInput("");
    await run(() => engine.send(text));
  }

  async function submitUiControl(text: string) {
    if (requestActive.current) return;
    if (mapAutoSubmitTimer.current) { clearTimeout(mapAutoSubmitTimer.current); mapAutoSubmitTimer.current = null; }
    requestActive.current = true;
    setError(""); setState("processing"); onBusyChange(true);
    try {
      await engine.executeUiControl(text);
      if (uiControlMode.current && !document.hidden) {
        if (uiRestartTimer.current) { clearTimeout(uiRestartTimer.current); uiRestartTimer.current = null; }
        liveDraft.current = "";
        setInput("");
        setMapVoiceTranscript("");
        setState("idle");
        onBusyChange(false);
        listen(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "That map control could not be completed.";
      if (uiControlMode.current && !document.hidden) {
        setMapVoiceTranscript("");
        setError(message);
        setState("idle");
        onBusyChange(false);
        listen(true);
      } else {
        uiControlMode.current = false;
        setUiControlActive(false);
        setError(message);
        setState("error"); onBusyChange(false);
      }
    } finally { requestActive.current = false; }
  }

  function toggleUiControl() {
    if (uiControlMode.current) {
      uiControlMode.current = false;
      setUiControlActive(false);
      setMapVoiceTranscript("");
      engine.clearUiControl();
      stopVoice();
      return;
    }
    interruptionEnabled.current = false;
    setAllowInterruptions(false);
    stopVoice();
    uiControlMode.current = true;
    panelOpen.current = true;
    setUiControlActive(true);
    setMapVoiceTranscript("");
    setCollapsed(true);
    listen(true);
  }

  function hideMobileAssistant() {
    if (uiControlMode.current) {
      uiControlMode.current = false;
      setUiControlActive(false);
      engine.clearUiControl();
    }
    stopVoice();
    setCollapsed(true);
    setMobileAssistantHidden(true);
  }

  function showMobileAssistant() {
    setMobileAssistantHidden(false);
    setCollapsed(false);
  }

  function listen(followup = false) {
    if (!followup && state === "listening") { stopVoice(); return; }
    if ((blocked && !followup) || (state === "processing" && !followup) || !panelOpen.current || document.hidden) return;
    if (uiRestartTimer.current) { clearTimeout(uiRestartTimer.current); uiRestartTimer.current = null; }
    if (!claimMicrophone(microphoneIdentity)) {
      setError("Another workspace is using the microphone. Stop it there before starting voice here.");
      setState("error");
      return;
    }
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
      startDelayMs: uiControlMode.current ? 250 : Date.now() - playbackStoppedAt.current < 400 ? 400 : 0,
      initialTranscript: beforeListening.current,
      onTranscript: (text, final) => {
        liveDraft.current = text;
        setInput(text.slice(0, 500));
        if (uiControlMode.current) {
          setMapVoiceTranscript(text.slice(0, 240));
          if (final && text.trim()) {
            if (mapAutoSubmitTimer.current) clearTimeout(mapAutoSubmitTimer.current);
            mapAutoSubmitTimer.current = setTimeout(() => {
              mapAutoSubmitTimer.current = null;
              abortListening.current?.();
              abortListening.current = null;
              void submitUiControl(text);
            }, 1000);
          }
        }
        if (engine.getSnapshot().pendingLocationChoices.length && final) {
          if (optionAutoSubmit.current) clearTimeout(optionAutoSubmit.current);
          optionAutoSubmit.current = setTimeout(() => {
            optionAutoSubmit.current = null;
            abortListening.current?.();
            abortListening.current = null;
            void submit(text, true);
            }, 2000);
        }
      },
      completeOnFinal: false,
      onComplete: (text) => { if (uiControlMode.current) void submitUiControl(text); else void submit(text, true); },
      onDiscard: () => { liveDraft.current = ""; beforeListening.current = ""; setInput(""); if (uiControlMode.current) setMapVoiceTranscript(""); },
      keepAlive: uiControlMode.current,
      maxDurationMs: followup ? 15000 : 90000,
      onError: (reason) => {
        releaseMicrophone(microphoneIdentity);
        voiceConversation.current = false;
        abortListening.current = null;
        if (uiControlMode.current && !["permission", "unsupported", "language"].includes(reason) && !document.hidden) {
          setError(""); setState("idle"); onBusyChange(false);
          uiRestartTimer.current = setTimeout(() => { uiRestartTimer.current = null; if (uiControlMode.current && !requestActive.current && !document.hidden) listen(true); }, 250);
          return;
        }
        if (uiControlMode.current) { uiControlMode.current = false; setUiControlActive(false); }
        setError(recognitionMessages[reason]); setState("error"); onBusyChange(false);
      },
      onEnd: () => {
        releaseMicrophone(microphoneIdentity);
        voiceConversation.current = false;
        abortListening.current = null;
        setState((current) => current === "listening" ? "idle" : current);
        onBusyChange(false);
        if (uiControlMode.current && !document.hidden) {
          uiRestartTimer.current = setTimeout(() => { uiRestartTimer.current = null; if (uiControlMode.current && !requestActive.current && !document.hidden) listen(true); }, 250);
        }
      },
    });
  }

  function setContinuousListening(enabled: boolean) {
    if (enabled && !claimMicrophone(microphoneIdentity)) {
      setError("Another workspace is using the microphone. Stop it there before enabling voice here.");
      return;
    }
    setAllowInterruptions(enabled);
    interruptionEnabled.current = enabled;
    if (enabled) { setError(""); armInterruption(); return; }
    stopInterruption.current?.(); stopInterruption.current = null;
    releaseMicrophone(microphoneIdentity);
    microphoneReady.current = false;
    queuedVoiceRequests.current = [];
    setInterruptionReady(false);
    if (!replyActive.current && !requestActive.current) { setState(abortListening.current ? "listening" : "idle"); onBusyChange(Boolean(abortListening.current)); }
    pendingPlayback.current?.();
  }

  function scheduleTypedOption(text: string) {
    const choices = engine.getSnapshot().pendingLocationChoices;
    const selectedOption = lastOptionIndex(text);
    const validOption = selectedOption !== undefined && selectedOption >= 0 && selectedOption < choices.length;
    if (!choices.length || !validOption) {
      if (optionAutoSubmit.current) clearTimeout(optionAutoSubmit.current);
      optionAutoSubmit.current = null;
      return;
    }
    if (optionAutoSubmit.current) clearTimeout(optionAutoSubmit.current);
    optionAutoSubmit.current = setTimeout(() => {
      optionAutoSubmit.current = null;
      void submit(text, true);
    }, 2000);
  }

  useEffect(() => {
    resumeListening.current = (followup = true) => listen(followup);
    resumeSubmission.current = (text) => { void submit(text, true); };
    if (!blocked && !requestActive.current && interruptionEnabled.current && panelOpen.current && !document.hidden && queuedVoiceRequests.current.length) {
      const queued = queuedVoiceRequests.current.shift();
      if (queued) void submit(queued, true);
    }
  });

  const uiControlButton = <div className="map-voice-header-control"><button type="button" className={`ui-control-button ${uiControlActive ? "active" : ""}`} title={uiControlActive ? "Disable map voice" : "Enable map voice"} aria-label={uiControlActive ? "Map voice enabled. Click to disable" : "Map voice disabled. Click to enable"} aria-pressed={uiControlActive} onClick={toggleUiControl} disabled={!voiceSupported || (blocked && !uiControlActive && state !== "listening")}><Layers size={15} /><span>Map voice: {uiControlActive ? "Enabled" : "Disabled"}</span></button>{uiControlActive && mapVoiceTranscript && <span className="map-voice-transcript" role="status" aria-live="polite">{mapVoiceTranscript}</span>}</div>;

  return <>
    {uiControlHost ? createPortal(uiControlButton, uiControlHost) : uiControlButton}
    {(mobileAssistantHidden || collapsed) && <button className="assistant-mobile-launch" type="button" onClick={showMobileAssistant} aria-label="Open VoiceNav assistant" title="Open VoiceNav assistant"><Mic size={20} /></button>}
    <section className={`assistant-panel ${collapsed ? "assistant-collapsed" : ""} ${mobileAssistantHidden ? "assistant-mobile-hidden" : ""}`} aria-labelledby="assistant-title">
    <header className="assistant-header"><span className={`assistant-symbol ${state === "listening" ? "listening" : ""}`}><AudioLines size={21} /></span><div><h2 id="assistant-title">VoiceNav assistant</h2><span className={`assistant-status state-${status}`}><i />{statusLabel}</span></div><button className="icon-button assistant-mobile-hide" type="button" onClick={hideMobileAssistant} aria-label="Hide assistant" title="Hide assistant"><X size={18} /></button><button className="icon-button" onClick={() => { if (collapsed) { if (uiControlMode.current) { uiControlMode.current = false; setUiControlActive(false); engine.clearUiControl(); stopVoice(); } } else { voiceConversation.current = false; setContinuousListening(false); if (!uiControlMode.current && (state === "listening" || state === "responding")) stopVoice(); } setCollapsed(!collapsed); }} aria-expanded={!collapsed} aria-label={collapsed ? "Expand assistant" : "Collapse assistant"} title={collapsed ? "Expand assistant" : "Collapse assistant"}>{collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button></header>
    {!collapsed && <>
      <div className="conversation" ref={messages} role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
        {context.messages.length === 0 ? <div className="conversation-empty"><AudioLines size={29} /><span>Your journey, in conversation.</span></div> : context.messages.map((message) => <div key={message.id} className={`message message-${message.role}`}><span className="message-role">{message.role === "assistant" ? "VoiceNav · Local" : "You"}{message.role === "assistant" && <button className="icon-button" type="button" title="Read this reply aloud" aria-label="Read this reply aloud" onClick={() => playReply(message.text, message.spokenText)} disabled={blocked || state === "processing"}><Volume2 size={13} /></button>}</span><p>{message.text}</p></div>)}
        {state === "processing" && <div className="thinking"><LoaderCircle size={13} className="spin" /> Processing request</div>}
      </div>
      {context.pendingLocationChoices.length > 0 && <div className="confirmation"><span>{context.pendingMapAction ? "Map locations" : "Destination matches"}</span><ol className="address-results">{context.pendingLocationChoices.map((location, index) => <li key={location.id}><button type="button" disabled={blocked || state === "processing"} onClick={() => void run(() => engine.chooseLocation(index))}>Option {index + 1}: {location.name}</button></li>)}</ol></div>}
      {context.pendingDestination && <div className="confirmation"><span>{context.pendingOrigin ? "New route" : "Destination change"}</span>{context.pendingOrigin && <p>From {context.pendingOrigin.name}</p>}<strong>{context.pendingDestination.name}</strong><div><button className="primary-button" disabled={blocked || processing} onClick={() => void run(() => engine.confirm())}><Check size={14} />{context.pendingOrigin ? "Confirm route" : "Confirm destination"}</button><button className="secondary-button" disabled={blocked || processing} onClick={() => engine.cancel()}><X size={14} />Cancel</button></div></div>}
      {error && <p className="voice-error" role="alert">{error}</p>}
      {!voiceSupported && <p className="voice-unavailable"><MicOff size={12} />Voice input unavailable. Text input is ready.</p>}
      <form className="assistant-form" onSubmit={(event) => { event.preventDefault(); void submit(input); }}>
        <label className="sr-only" htmlFor="assistant-message">Message the navigation assistant</label>
        <textarea id="assistant-message" lang={context.language === "hi" ? "hi" : "en"} placeholder={context.language === "hi" ? "अपनी मंज़िल या रास्ते के बारे में पूछिए…" : "Ask about your journey…"} rows={2} maxLength={500} value={input} onChange={(event) => { liveDraft.current = event.target.value; if (state === "listening") stopVoice(); setInput(event.target.value); scheduleTypedOption(event.target.value); }} disabled={processing || blocked || uiControlActive} autoComplete="off" onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(input); } }} />
        <button type="button" className={`mic-button ${state === "listening" && !uiControlActive ? "active" : ""}`} title={state === "listening" ? "Stop recording and keep draft" : state === "responding" ? "Interrupt reply and listen" : "Start voice input"} aria-label={state === "listening" ? "Stop recording and keep draft" : state === "responding" ? "Interrupt reply and listen" : "Start voice input"} aria-pressed={state === "listening"} onClick={() => listen()} disabled={!voiceSupported || state === "processing" || blocked || uiControlActive}>{state === "listening" ? <Square size={16} /> : <Mic size={18} />}</button>
        {state === "listening" && <button className="icon-button" type="button" title="Cancel voice draft" aria-label="Cancel voice draft" onClick={() => { if (interruptionEnabled.current) { stopInterruption.current?.(); stopInterruption.current = null; microphoneReady.current = false; liveDraft.current = ""; beforeListening.current = ""; setInput(""); armInterruption(); } else { stopVoice(); liveDraft.current = beforeListening.current; setInput(beforeListening.current); } }}><X size={15} /></button>}
        {state === "responding" ? <button className="icon-button" type="button" title="Stop speaking" aria-label="Stop speaking" onClick={stopVoice}><Square size={16} /></button> : <button className="send-button" type="submit" title={state === "listening" ? "Finish recording and send" : "Send message"} aria-label={state === "listening" ? "Finish recording and send" : "Send message"} disabled={!input.trim() || processing || blocked || uiControlActive}>{state === "processing" ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}</button>}
      </form>
      <footer className="assistant-footer"><label htmlFor="assistant-language">Language<select id="assistant-language" value={context.language} disabled={blocked || state !== "idle" && state !== "error"} onChange={(event) => { engine.setLanguage(event.target.value === "hi" ? "hi" : "en"); stopVoice(); }}><option value="en">English</option><option value="hi">हिन्दी / Deccani</option></select></label><label title="Spoken replies"><Volume2 size={12} /><span>Spoken replies</span><input type="checkbox" checked={spoken} onChange={(event) => { const enabled = event.target.checked; setSpoken(enabled); speechEnabled.current = enabled; if (!enabled && replyActive.current) { playbackStoppedAt.current = Date.now(); stopSpeaking.current?.(); stopSpeaking.current = null; finishReply(); } }} /></label></footer>
      <footer className="assistant-footer"><label title={`Keep listening between replies and interrupt without a wake phrase. Finish with ${sendPhrase} or Submit to submit, or Discard to clear the draft. The microphone and playback buttons do not disable this setting. Uncheck to stop automatic listening; hiding the page or collapsing the panel also stops it. Uses an echo-cancelled microphone; browser support varies.`}><Mic size={12} /><span>Allow interruptions</span><input type="checkbox" checked={allowInterruptions} disabled={!voiceSupported} onChange={(event) => setContinuousListening(event.target.checked)} /></label></footer>
    </>}
    </section>
  </>;
}