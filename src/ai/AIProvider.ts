import type { ConversationContext, NavigationSession } from "@/types/domain";

export type IntentInput = { text: string; context: ConversationContext; session: NavigationSession };
export type AIProviderStatus = "local" | "checking" | "connected" | "unavailable";
export type AIModelProvider = "gemini" | "muse" | "meta";

export interface AIProvider {
  readonly label: string;
  readonly mode: "local" | "model";
  process(input: IntentInput): Promise<unknown>;
  getStatus?: () => AIProviderStatus;
  subscribeStatus?: (listener: () => void) => () => void;
  getProvider?: () => AIModelProvider | null;
}