"use client";

import { LoaderCircle, MessageCircle, Send, X } from "lucide-react";
import { useState } from "react";
import type { AssistantQuerySnapshot } from "@/types/domain";

type Props = { snapshot: AssistantQuerySnapshot; blocked: boolean; onAsk: (query: string) => Promise<string | null>; onCancel: () => void };

export function ParallelAssistantPanel({ snapshot, blocked, onAsk, onCancel }: Props) {
  const [query, setQuery] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    setQuery("");
    await onAsk(value);
  };
  return <section className="parallel-assistant" aria-labelledby="parallel-assistant-heading">
    <div className="section-heading"><div><span className="eyebrow">PARALLEL ASSISTANT</span><h2 id="parallel-assistant-heading">Ask without changing the route</h2></div><MessageCircle size={20} className="muted-icon" /></div>
    <form className="assistant-query" onSubmit={submit}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask about time, distance, or traffic" maxLength={500} disabled={blocked || snapshot.status === "running"} aria-label="Ask the parallel assistant" />
      {snapshot.status === "running" ? <button type="button" className="icon-button" onClick={onCancel} title="Cancel assistant request" aria-label="Cancel assistant request"><X size={15} /></button> : <button type="submit" className="icon-button" disabled={blocked || !query.trim()} title="Ask assistant" aria-label="Ask assistant"><Send size={15} /></button>}
    </form>
    {snapshot.status === "running" && <p className="assistant-answer"><LoaderCircle size={14} className="spin" />Checking current route context</p>}
    {snapshot.answer && snapshot.status === "complete" && <p className="assistant-answer" role="status">{snapshot.answer}</p>}
    {snapshot.error && <p className="field-error" role="alert">{snapshot.error}</p>}
  </section>;
}
