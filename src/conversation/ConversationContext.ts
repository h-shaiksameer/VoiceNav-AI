import type { ConversationContext, Message } from "@/types/domain";

export function emptyContext(): ConversationContext {
  return { language: "en", messages: [], recentPlaces: [], selectedPlaceId: null, lastSearchScope: null, pendingDestination: null, pendingOrigin: null, pendingLocationChoices: [], pendingSourceText: null, pendingRevision: null };
}

export function clearPendingNavigation(context: ConversationContext): ConversationContext {
  return {
    ...context,
    pendingDestination: null,
    pendingOrigin: null,
    pendingLocationChoices: [],
    pendingSourceText: null,
    pendingRevision: null,
  };
}

export function addMessage(context: ConversationContext, role: Message["role"], text: string, spokenText?: string): ConversationContext {
  const message: Message = role === "assistant" ? { id: crypto.randomUUID(), role, text, spokenText } : { id: crypto.randomUUID(), role, text };
  return { ...context, messages: [...context.messages, message].slice(-30) };
}