import type { AIModelProvider, AIProvider, AIProviderStatus, IntentInput } from "../AIProvider";
import { intentSchema } from "@/types/schemas";

type IntentRequest = {
  text: string;
  language: IntentInput["context"]["language"];
  recentPlaces: Array<{ name: string; category: string }>;
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>;
  lastSearchScope: IntentInput["context"]["lastSearchScope"];
  session: { hasOrigin: boolean; hasDestination: boolean; hasRoute: boolean; destinationName: string | null };
};

const endpoint = "/api/ai/intent";
const modelRequestTimeoutMs = 17000;

export class BasetenIntentProvider implements AIProvider {
  readonly label = "Meta Muse Spark Open via Baseten";
  readonly mode = "model" as const;
  private status: AIProviderStatus = "local";
  private activeProvider: AIModelProvider | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly request: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  getStatus = (): AIProviderStatus => this.status;
  getProvider = (): AIModelProvider | null => this.activeProvider;
  subscribeStatus = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  private setStatus(status: AIProviderStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener());
  }

  async process({ text, context, session }: IntentInput): Promise<unknown> {
    this.activeProvider = null;
    this.setStatus("checking");
    const body: IntentRequest = {
      text: text.slice(0, 500),
      language: context.language,
      recentPlaces: context.recentPlaces.slice(0, 12).map(({ name, category }) => ({ name: name.slice(0, 160), category })),
      recentMessages: context.messages.slice(-4).map(({ role, text: message }) => ({ role, text: message.slice(0, 300) })),
      lastSearchScope: context.lastSearchScope,
      session: {
        hasOrigin: Boolean(session.origin),
        hasDestination: Boolean(session.destination),
        hasRoute: Boolean(session.route),
        destinationName: session.destination?.name.slice(0, 160) ?? null,
      },
    };
    try {
      console.info(`[VoiceNav AI] POST ${endpoint} -> request started`);
      const response = await this.request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(modelRequestTimeoutMs),
      });
      console.info(`[VoiceNav AI] POST ${endpoint} -> ${response.status}`);
      if (!response.ok) {
        console.warn("[VoiceNav AI] Optional model request returned an error.", { status: response.status });
        this.setStatus(response.status === 503 ? "local" : "unavailable");
        throw new Error("Meta AI is unavailable. The local engine is handling this request.");
      }
      const payload = await response.json() as { intent?: unknown; provider?: AIModelProvider };
      const parsed = intentSchema.safeParse(payload.intent);
      if (!parsed.success || (payload.provider !== "gemini" && payload.provider !== "muse" && payload.provider !== "meta")) {
        this.setStatus("unavailable");
        throw new Error("Meta AI returned an invalid intent. The local engine is handling this request.");
      }
      this.activeProvider = payload.provider;
      this.setStatus("connected");
      console.info(`[VoiceNav AI] intent source: ${payload.provider}`);
      return parsed.data;
    } catch (error) {
      if (this.status === "checking") this.setStatus("unavailable");
      console.warn("[VoiceNav AI] Optional model failed; local engine is handling this request.", error instanceof Error ? error.message : error);
      console.trace("[VoiceNav AI] model failure call stack");
      throw error;
    }
  }
}