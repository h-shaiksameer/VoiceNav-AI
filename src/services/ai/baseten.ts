import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { intentSchema } from "@/types/schemas";
import { ServiceError } from "@/services/server/http";

export const basetenIntentRequestSchema = z.object({
  text: z.string().trim().min(1).max(500),
  language: z.enum(["en", "hi"]),
  recentPlaces: z.array(z.object({ name: z.string().min(1).max(160), category: z.string().min(1).max(40) }).strict()).max(12),
  recentMessages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(300) }).strict()).max(4),
  lastSearchScope: z.enum(["nearby", "route"]).nullable(),
  session: z.object({ hasOrigin: z.boolean(), hasDestination: z.boolean(), hasRoute: z.boolean(), destinationName: z.string().max(160).nullable() }).strict(),
}).strict();

export type AIIntentRequest = z.infer<typeof basetenIntentRequestSchema>;
const geminiModel = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
const museModel = process.env.BASETEN_MODEL?.trim() || "meta-models/muse-spark-open";
const metaModel = process.env.META_MODEL?.trim() || "muse-spark-open";
const metaApiBaseUrl = (process.env.META_API_BASE_URL?.trim() || "https://api.llama.com/v1").replace(/\/$/, "");
const modelRequestTimeoutMs = 15000;

export const intentSystemPrompt = `You are the intent classifier inside VoiceNav AI. The user's original words are in the request field. Understand that message and return only one JSON object matching this shape:
{"type":"GET_ETA|GET_ROUTE_DISTANCE|GET_DISTANCE_BETWEEN|GET_TRAVEL_TIME_BETWEEN|LOOKUP_LOCATION|GET_TRAFFIC|GET_ROUTE_ALTERNATIVES|PLAN_ROUTE|SEARCH_NEARBY|SEARCH_ALONG_ROUTE|COMPARE_OPTIONS|GET_PLACE_DETAILS|CHANGE_DESTINATION|STOP_NAVIGATION|MAP_ZOOM|CLARIFY","category":"fuel|restaurant|hospital|pharmacy|atm|parking|cafe|charging_station","reference":0,"query":"text","originQuery":"text","clarification":"text","mapAction":"zoom-in|zoom-out|reset|center|pan-left|pan-right|pan-up|pan-down"}
Omit fields that are not needed. The application, not you, performs geocoding, place searches, routing, map changes, confirmations, and navigation state changes. Your only job is to classify the user's intent and provide the text inputs the application must search.

Field contract:
- query is the raw place, address, or destination phrase after removing command words such as "go to", "navigate to", or "find". For "go to destination Charminar", query is "Charminar".
- When the user asks where a place is and explicitly follows with "take me there" or an equivalent, classify it as CHANGE_DESTINATION and set query to the named place. For "where is Charminar, take me there", query is "Charminar".
- originQuery is the raw starting-location phrase for PLAN_ROUTE.
- For GET_DISTANCE_BETWEEN or GET_TRAVEL_TIME_BETWEEN, query is the destination place and originQuery is the starting place.
- Use LOOKUP_LOCATION for "where is X" when the user asks for a place's location without asking to navigate there. Use reference for "where is this/that" when it refers to a recent result.
- category is required for SEARCH_NEARBY or SEARCH_ALONG_ROUTE and must be one allowed category.
- reference is a zero-based index into recentPlaces for a numbered or clearly selected result. Never invent an index.
- clarification is a short response when the request is ambiguous, unsupported, negated, or outside this application's capabilities.
- mapAction is used only for an explicit map-control request; it never changes a destination or route.

Use only facts present in the user request and supplied context. Never invent coordinates, IDs, places, distances, routes, hours, prices, ratings, or availability. Use SEARCH_NEARBY or SEARCH_ALONG_ROUTE for place searches, LOOKUP_LOCATION for place-location questions, GET_DISTANCE_BETWEEN or GET_TRAVEL_TIME_BETWEEN for two named places, GET_ETA/GET_ROUTE_DISTANCE/GET_TRAFFIC/GET_ROUTE_ALTERNATIVES/COMPARE_OPTIONS/GET_PLACE_DETAILS for other read-only questions, and CHANGE_DESTINATION only for an explicit destination instruction. Use PLAN_ROUTE only when both an origin and destination are explicitly provided. Use CLARIFY for uncertainty, hypotheticals, negation, or unsupported requests. Return a clarification rather than guessing when no allowed intent matches.`;

export function intentPromptFor(input: AIIntentRequest): string {
  return JSON.stringify({ request: input.text, language: input.language, recentPlaces: input.recentPlaces, recentMessages: input.recentMessages, lastSearchScope: input.lastSearchScope, session: input.session });
}

function parseIntentContent(content: string): z.infer<typeof intentSchema> {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let output: unknown;
  try { output = JSON.parse(normalized); } catch { throw new ServiceError("AI provider returned malformed JSON.", 502); }
  const parsed = intentSchema.safeParse(output);
  if (!parsed.success) throw new ServiceError("AI provider returned an invalid intent.", 502);
  return parsed.data;
}

export async function inferBasetenIntent(input: AIIntentRequest): Promise<z.infer<typeof intentSchema>> {
  const apiKey = process.env.BASETEN_API_KEY?.trim();
  if (!apiKey) throw new ServiceError("Muse Spark is not configured. The local engine is active.", 503);
  const client = new OpenAI({ apiKey, baseURL: "https://inference.baseten.co/v1", maxRetries: 0, timeout: modelRequestTimeoutMs });
  try {
    const completion = await client.chat.completions.create({
      model: museModel,
      temperature: 0,
      max_tokens: 180,
      messages: [{ role: "system", content: intentSystemPrompt }, { role: "user", content: intentPromptFor(input) }],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content || Array.isArray(content)) throw new ServiceError("Meta AI returned no structured intent.", 502);
    return parseIntentContent(content);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    const status = error instanceof OpenAI.APIError && error.status === 429 ? 429 : 502;
    console.warn("[VoiceNav AI] Muse Spark request failed; local engine is handling this request.", { status, reason: error instanceof Error ? error.message : "unknown error" });
    throw new ServiceError(status === 429 ? "Muse Spark is rate limited. The local engine is active." : "Muse Spark is unavailable. The local engine is active.", status);
  }
}

export async function inferMetaIntent(input: AIIntentRequest): Promise<z.infer<typeof intentSchema>> {
  const apiKey = process.env.META_API_KEY?.trim();
  if (!apiKey) throw new ServiceError("Meta Model API is not configured. The local engine is active.", 503);
  try {
    const response = await fetch(`${metaApiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: metaModel,
        temperature: 0,
        max_tokens: 180,
        messages: [{ role: "system", content: intentSystemPrompt }, { role: "user", content: intentPromptFor(input) }],
      }),
      signal: AbortSignal.timeout(modelRequestTimeoutMs),
    });
    if (response.status === 429) {
      console.warn("[VoiceNav AI] Meta Model API request was rate limited; local engine is handling this request.");
      throw new ServiceError("Meta AI is rate limited. The local engine is active.", 429);
    }
    if (!response.ok) {
      console.warn("[VoiceNav AI] Meta Model API request failed; local engine is handling this request.", { model: metaModel, status: response.status });
      throw new ServiceError("Meta AI is unavailable. The local engine is active.", 502);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new ServiceError("Meta AI returned no structured intent.", 502);
    return parseIntentContent(content);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    console.warn("[VoiceNav AI] Meta Model API request failed; local engine is handling this request.", { model: metaModel, reason: error instanceof Error ? error.message : "unknown error" });
    throw new ServiceError("Meta AI is unavailable. The local engine is active.", 502);
  }
}

export async function inferGeminiIntent(input: AIIntentRequest): Promise<z.infer<typeof intentSchema>> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new ServiceError("Gemini is not configured. The local engine is active.", 503);
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: intentSystemPrompt }] },
        contents: [{ role: "user", parts: [{ text: intentPromptFor(input) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 180 },
      }),
      signal: AbortSignal.timeout(modelRequestTimeoutMs),
    });
    if (response.status === 429) {
      console.warn("[VoiceNav AI] Gemini request was rate limited; local engine is handling this request.");
      throw new ServiceError("Gemini is rate limited. The local engine is active.", 429);
    }
    if (!response.ok) {
      console.warn("[VoiceNav AI] Gemini request failed; local engine is handling this request.", { model: geminiModel, status: response.status });
      throw new ServiceError("Gemini is unavailable. The local engine is active.", 502);
    }
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const content = payload.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
    if (!content) throw new ServiceError("Gemini returned no structured intent.", 502);
    return parseIntentContent(content);
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    console.warn("[VoiceNav AI] Gemini request failed; local engine is handling this request.", { model: geminiModel, reason: error instanceof Error ? error.message : "unknown error" });
    throw new ServiceError("Gemini is unavailable. The local engine is active.", 502);
  }
}

function enabled(value: string | undefined): boolean {
  return ["on", "true", "1", "yes"].includes(value?.trim().toLowerCase() ?? "");
}

export async function inferConfiguredIntent(input: AIIntentRequest): Promise<{ intent: z.infer<typeof intentSchema>; provider: "gemini" | "muse" | "meta" }> {
  if (enabled(process.env.META_ENABLED) && process.env.META_API_KEY?.trim()) return { intent: await inferMetaIntent(input), provider: "meta" };
  if (enabled(process.env.GEMINI_ENABLED) && process.env.GEMINI_API_KEY?.trim()) return { intent: await inferGeminiIntent(input), provider: "gemini" };
  if (enabled(process.env.BASETEN_ENABLED) && process.env.BASETEN_API_KEY?.trim()) return { intent: await inferBasetenIntent(input), provider: "muse" };
  throw new ServiceError("No optional AI provider is enabled. The local engine is active.", 503);
}