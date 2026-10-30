import type { ConversationContext, NavigationSession } from "@/types/domain";

export type IntentInput = { text: string; context: ConversationContext; session: NavigationSession };

export interface AIProvider {
  readonly label: string;
  readonly mode: "local" | "model";
  process(input: IntentInput): Promise<unknown>;
}