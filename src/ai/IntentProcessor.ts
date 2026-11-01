import type { AIProvider, IntentInput } from "./AIProvider";
import { intentSchema } from "@/types/schemas";
import { ambiguousReference, contextualReference, destinationInstruction, routeInstruction, stopInstruction } from "@/navigation/commands";
import { LocalIntentProvider } from "./providers/LocalIntentProvider";
import { matchingCategories } from "@/utils/categories";
import type { Intent } from "@/types/domain";

export class IntentProcessor {
  private readonly local = new LocalIntentProvider();
  constructor(private readonly provider: AIProvider = new LocalIntentProvider()) {}

  async process(input: IntentInput): Promise<Intent> {
    let output: unknown;
    try { output = await this.provider.process(input); }
    catch { output = await this.local.process(input); }
    let parsed = intentSchema.safeParse(output);
    if (!parsed.success) parsed = intentSchema.safeParse(await this.local.process(input));
    if (!parsed.success) return { type: "CLARIFY" };
    const intent = parsed.data;
    if (intent.type === "PLAN_ROUTE") {
      const plan = routeInstruction(input.text);
      return plan ? { type: "PLAN_ROUTE", ...plan } : { type: "CLARIFY", clarification: "Give an explicit starting location and destination for the route." };
    }
    if (ambiguousReference(input.text)) return { type: "CLARIFY", clarification: "You mentioned multiple results. Choose one result number." };
    if (intent.type === "CHANGE_DESTINATION") {
      const instruction = destinationInstruction(input.text) ?? (intent.query ? destinationInstruction(intent.query) : null);
      if (!instruction) return { type: "CLARIFY" };
      const matches = matchingCategories(input.text);
      if (matches.length > 1) return { type: "CLARIFY", clarification: "Choose a single place type or destination." };
      return { type: "CHANGE_DESTINATION", query: instruction, reference: contextualReference(input.text, input.context), category: matches[0]?.value };
    }
    if (intent.type === "STOP_NAVIGATION" && !stopInstruction(input.text)) return { type: "CLARIFY" };
    return intent;
  }
}