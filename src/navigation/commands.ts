import type { ConversationContext } from "@/types/domain";
import { hindiDestination, hindiNegation, hindiReferenceText, hindiRoute, hindiStop, normalizeHindi } from "@/ai/language";

export function normalizeLanguage(text: string): string {
  return text.normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[।॥]/g, ".").replace(/\s+/g, " ").trim();
}

export function routeInstruction(text: string): { originQuery: string; query: string } | null {
  if (hindiNegation(text)) return null;
  const hindi = hindiRoute(text);
  if (hindi) return hindi;
  const clean = normalizeLanguage(text).replace(/[.!?]+$/, "").replace(/^(?:please |kindly )?(?:(?:can|could|would) you (?:please )?)?/i, "");
  if (/\b(?:don't|do not|never|if|unless|but|or|without)\b/i.test(clean)) return null;
  const originLabel = "(?:starting (?:location|point)|start (?:location|point)|origin)";
  const targetLabel = "(?:target(?: location)?|destination(?: location)?|ending (?:location|point)|end (?:location|point))";
  const relation = "(?:as|to|is|:|=)";
  const labelled = new RegExp(`^(?:select|set|choose|use) (?:my |the )?${originLabel}(?:,?\\s*location)?\\s*${relation}\\s+(.+?)\\s+and\\s+(?:(?:set|select|choose) )?(?:my |the )?${targetLabel}\\s*${relation}\\s+(.+)$`, "i");
  const fromTo = /^(?:(?:plan|calculate|find|show|create|start)(?: me)?(?: a| the| my)?(?: driving)? route|navigate|take me|drive|go) from (.+?) to (.+)$/i;
  const reverse = clean.match(/^(?:navigate(?: me)?|take me|drive(?: me)?|go) to (.+?) from (.+)$/i);
  const match = clean.match(labelled) ?? clean.match(fromTo) ?? (reverse ? [reverse[0], reverse[2], reverse[1]] : null);
  if (!match) return null;
  const originQuery = match[1].trim();
  const query = match[2].trim();
  if (!originQuery || !query || /[?!;]/.test(`${originQuery} ${query}`) || /\band\s+(?:then|navigate|take|stop|go)\b/i.test(query)) return null;
  return { originQuery, query };
}

export function currentLocationReference(text: string): boolean {
  return /^(?:(?:my|the|meri|mere) )?(?:current(?: gps)?(?: location|position)?|gps location|here|where i am|location|yahan|yahaan|idhar|abhi ki location)$|^my location$/i.test(normalizeHindi(normalizeLanguage(text)));
}

function destinationName(text: string): string | null {
  if (/[?？;]/u.test(text)) return null;
  const candidate = text.replace(/[.!]+$/u, "").trim()
    .replace(/^(?:please|kindly)\s+/i, "")
    .replace(/^(?:(?:i want|i need|i(?:'d| would) like)(?: to (?:visit|reach))?|(?:take|get|bring|route|direct) me(?: to)?|(?:navigate(?: me)?|go|drive(?: me)?|head|visit)(?: to)?)\s+/i, "")
    .replace(/[,\s]+(?:please|thanks|thank you)$/i, "").trim();
  if (candidate.length < 3 || candidate.length > 300 || !/\p{L}/u.test(candidate) || !/^[\p{L}\p{M}\p{N}\s,.'’()/#&:+-]+$/u.test(candidate)) return null;
  const normalized = normalizeHindi(candidate);
  if (/^(?:(?:mujhe|mereko|mereku|mere|meri|mera)\s+)?(?:ghar|kaam)(?:\s+(?:le|leke|lekar)\s+(?:chalo|jao))?$/i.test(normalized)) return null;
  if (hindiNegation(candidate) || lastOptionIndex(candidate) !== undefined || currentLocationReference(candidate)) return null;
  if (/\b(?:any|some|all|check|look|looking|wonder|help|near|closest|quickest|fastest|shortest|detours?|available|availability)\b|\bon (?:my |the |our )?way\b|\ben route\b/i.test(normalized)) return null;
  if (/\s&\s/u.test(candidate) || /\b(?:and|no|not|never|neither|yes|okay|ok|thanks|here|there|it|that|this|somewhere|anywhere|what|which|who|where|when|why|how|can|could|would|should|will|does|do|did|is|are|was|were|tell|explain|know|about|information|details?|opening|hours?|open|closed|address|website|ratings?|compare|versus|vs|traffic|congestion|closures?|eta|arrival|time|distance|nearby|nearest|near me|along|alternatives?|route|routes|options?|results?|confirm|cancel|stop|discard|send|submit|destination|target|home|work|find|search|show|list|kya|kaun|kaunsa|konsa|kahan|kidhar|kab|kyun|kaise|kitna|kitni|kitne|waqt|samay|doori|jaankari|baare|khula|khuli|batao|dikhao|paas|nazdeek|aaspaas|rasta|raste|haan|han|hau|theek)\b/i.test(normalized)) return null;
  if (/^(?:(?:petrol|gas|fuel|charging)\s+(?:stations?|pumps?)|restaurants?|cafes?|hospitals?|pharmac(?:y|ies)|atms?|parking|chargers?|coffee)$/i.test(candidate)) return null;
  return candidate;
}

export function destinationInstruction(text: string): string | null {
  if (hindiNegation(text)) return null;
  const hindi = hindiDestination(text);
  if (hindi) return hindi;
  const clean = normalizeLanguage(text).replace(/^(?:hey[, ]+)?voice\s?nav[,! ]+/i, "");
  if (/\b(?:don't|do not|never|unless|if|or|but|and then|without (?:changing|navigating))\b/i.test(clean)) return null;
  if (/\band\s+(?:take|go|drive|navigate|find|show|stop)\b/i.test(clean)) return null;
  const prefix = "(?:(?:please|kindly) )?(?:(?:can|could|would|will) you (?:please )?)?";
  const direct = new RegExp(`^${prefix}(?:take me|get me|bring me|route me|direct me|navigate(?: me)?|go|drive(?: me)?|head|reroute(?: me)?) to (.+?)[.!?]*$`, "i");
  const set = new RegExp(`^${prefix}(?:change|set|switch) (?:my |the )?(?:new )?destination to (.+?)[.!?]*$`, "i");
  const labelled = new RegExp(`^${prefix}(?:(?:set|select|choose|use) )?(?:my |the )?(?:target(?: location)?|destination(?: location)?)(?:\\s*[:=]\\s*|\\s+(?:(?:as|to|is)\\s+)?)(.+?)[.]*$`, "i");
  const desire = /^(?:i want to|i need to|i(?:'d| would) like to|let's) (?:go|drive|head|navigate) to (.+?)[.!?]*$/i;
  const there = new RegExp(`^${prefix}(?:take me|navigate|go|drive|head) (there|here)[.!?]*$`, "i");
  const labelMatch = clean.match(labelled);
  if (labelMatch && /^(?:as|to|is|location)$/i.test(labelMatch[1])) return null;
  const match = clean.match(direct) ?? clean.match(set) ?? clean.match(desire) ?? clean.match(there) ?? labelMatch;
  const target = match ? match[1].replace(/[, ]+(?:please|thanks|thank you)$/i, "").trim() : destinationName(clean);
  if (!target || /[?!;]/.test(target) || /\b(?:then|also|instead|after that)\b/i.test(target)) return null;
  return target;
}

export function stopInstruction(text: string): boolean {
  if (hindiNegation(text)) return false;
  if (hindiStop(text)) return true;
  return /^(?:please )?(?:(?:can|could|would) you (?:please )?)?(?:stop|cancel|end|clear) (?:navigation|(?:the |my )?(?:route|route preview|navigation))[.!?]*$/i.test(normalizeLanguage(text));
}

const ordinalWords = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];
const numberWords = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const resultNoun = "(?:one|result|option|place|restaurant|cafe|hospital|pharmacy|atm|station|petrol station|gas station|petrol pump|fuel pump|parking|charger|charging station)s?";

export function lastOptionIndex(text: string): number | undefined {
  if (/[?？]/u.test(text)) return undefined;
  const clean = normalizeLanguage(hindiReferenceText(text));
  const lead = "(?:please\\s+)?(?:(?:(?:i\\s+)?(?:choose|select|pick|use|take|want|prefer)|i(?:'ll| will)\\s+(?:take|choose|pick)|i(?:'d| would)\\s+like|(?:i(?:'ll| will)\\s+)?go\\s+with)\\s+)?(?:the\\s+)?";
  const choice = `${lead}(?:(?:(?:option|number)\\s*#?\\s*)?(\\d{1,2}|${numberWords.join("|")})|(${ordinalWords.join("|")})(?:\\s+(?:one|option|result))?)(?:\\s+(?:chuno|select karo|please|for me))?`;
  if (!new RegExp(`^${choice}(?:[\\s,;.!]+${choice})*[\\s,;.!]*$`, "i").test(clean)) return undefined;
  const last = Array.from(clean.matchAll(new RegExp(choice, "gi"))).at(-1);
  if (!last) return undefined;
  if (last[2]) return ordinalWords.indexOf(last[2].toLowerCase());
  const wordIndex = numberWords.indexOf(last[1].toLowerCase());
  return wordIndex >= 0 ? wordIndex : Number(last[1]) - 1;
}

function referenceIndices(text: string): number[] {
  const clean = normalizeLanguage(hindiReferenceText(text));
  const found = ordinalWords.flatMap((word, index) => new RegExp(`\\b${word}\\b(?=\\s+${resultNoun}\\b|[.!?]*$)`, "i").test(clean) ? [index] : []);
  for (const match of clean.matchAll(/\b(?:option|result|number|place)\s*#?\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi)) {
    const wordIndex = numberWords.indexOf(match[1].toLowerCase());
    found.push(wordIndex >= 0 ? wordIndex : Number(match[1]) - 1);
  }
  const ordinalNumber = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)\\b(?=\\s+${resultNoun}\\b|[.!?]*$)`, "gi");
  for (const match of clean.matchAll(ordinalNumber)) found.push(Number(match[1]) - 1);
  const ordinalPair = new RegExp(`\\b(${ordinalWords.join("|")})\\s+(?:and|or)\\s+(?:the\\s+)?(${ordinalWords.join("|")})\\b`, "gi");
  for (const match of clean.matchAll(ordinalPair)) found.push(ordinalWords.indexOf(match[1].toLowerCase()), ordinalWords.indexOf(match[2].toLowerCase()));
  if (found.length) {
    for (const match of clean.matchAll(/\b(?:and|or)\s+(\d{1,2}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi)) {
      const value = match[1].toLowerCase();
      const ordinal = ordinalWords.indexOf(value);
      const number = numberWords.indexOf(value);
      found.push(ordinal >= 0 ? ordinal : number >= 0 ? number : Number(value) - 1);
    }
  }
  return [...new Set(found)];
}

export function referenceIndex(text: string): number | undefined {
  const indices = referenceIndices(text);
  return indices.length === 1 ? indices[0] : undefined;
}

export function ambiguousReference(text: string): boolean { return referenceIndices(text).length > 1; }

export function contextualReference(text: string, context: ConversationContext): number | undefined {
  const explicit = referenceIndex(text);
  if (explicit !== undefined) return explicit;
  const target = destinationInstruction(text);
  if (target && !/^(?:there|here|it|that|this|(?:the |that |this )?(?:one|place))$/i.test(target)) return undefined;
  if (!/\b(?:there|here|that one|this one|that place|this place|it|wahan|udhar|yahan|idhar|us jagah|is jagah)\b/i.test(normalizeHindi(text))) return undefined;
  if (context.selectedPlaceId) {
    const index = context.recentPlaces.findIndex((place) => place.id === context.selectedPlaceId);
    if (index >= 0) return index;
  }
  return context.recentPlaces.length === 1 ? 0 : undefined;
}

export function distanceBetweenInstruction(text: string): { originQuery: string; query: string } | null {
  const clean = normalizeLanguage(text).replace(/[.!?]+$/, "").trim();
  const match = clean.match(/^(?:(?:please|kindly) )?(?:(?:what is|what's|calculate|check|find|tell me|give me) )?(?:the )?(?:driving )?(?:distance|how far) between (.+?) and (.+)$/i);
  if (!match || /[?!;]/.test(`${match[1]} ${match[2]}`)) return null;
  const originQuery = match[1].trim();
  const query = match[2].trim();
  return originQuery && query ? { originQuery, query } : null;
}

