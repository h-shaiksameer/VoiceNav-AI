import type { AIProvider, IntentInput } from "../AIProvider";
import type { Intent } from "@/types/domain";
import { matchingCategories } from "@/utils/categories";
import { detectLanguage, hindiNegation, normalizeHindi } from "../language";
import { ambiguousReference, contextualReference, destinationInstruction, normalizeLanguage, routeInstruction, stopInstruction } from "@/navigation/commands";

export class LocalIntentProvider implements AIProvider {
  readonly label = "Local English, Hindi and Hinglish intent processor";
  readonly mode = "local" as const;

  async process({ text, context }: IntentInput): Promise<Intent> {
    const clean = normalizeLanguage(text);
    const plan = routeInstruction(clean);
    if (plan) return { type: "PLAN_ROUTE", ...plan };
    const query = destinationInstruction(clean);
    const matches = matchingCategories(clean);
    const category = matches.length === 1 ? matches[0].value : undefined;
    const reference = contextualReference(clean, context);
    const clarify = (clarification: string): Intent => ({ type: "CLARIFY", clarification });
    if (ambiguousReference(clean)) return clarify("You mentioned more than one result. Which single result should I use?");
    if (stopInstruction(clean)) return { type: "STOP_NAVIGATION" };
    if (query) {
      if (matches.length > 1) return clarify("You mentioned multiple place types. Choose one destination or one numbered result.");
      if (/^(?:there|here|it|that|this|(?:the |that |this )?(?:one|place))$/i.test(query) && reference === undefined) return clarify("Which place do you mean? Select a result or give its number or address.");
      return { type: "CHANGE_DESTINATION", query, category, reference };
    }
    const hindi = normalizeHindi(clean);
    if (detectLanguage(clean) === "hi") {
      if (hindiNegation(hindi) && /\b(?:le|leke|lekar|chalo|jao|jana|navigation|badlo|badal)\b/i.test(hindi)) return clarify("रास्ता नहीं बदला है। बताइए, आपको कौन सी जानकारी चाहिए?");
      if (/\b(?:doosra|dusra|doosre|dusre|aur|alag|doosri|dusri)\b.*\b(?:rasta|raste|route)\b|\b(?:rasta|route)\b.*\b(?:aur|doosra|dusra|alag)\b/i.test(hindi)) return { type: "GET_ROUTE_ALTERNATIVES" };
      if (/\b(?:traffic|jam)\b/i.test(hindi)) return { type: "GET_TRAFFIC" };
      if (/\b(?:kitna|kitni|kitne|kab)\b.*\b(?:time|waqt|samay|der|lagega|lagegi|pahunchenge)\b/i.test(hindi)) return { type: "GET_ETA" };
      if (/\b(?:kitna|kitni)\b.*\b(?:door|doori|distance|kilometer|km)\b|\b(?:door|doori|distance)\b.*\b(?:kitna|kitni)\b/i.test(hindi)) return reference !== undefined ? { type: "GET_PLACE_DETAILS", reference } : { type: "GET_ROUTE_DISTANCE" };
      if (/\b(?:compare|muqabla|tulna)\b|\b(?:kaunsa|konsa|kaun sa|kon sa)\b.*\b(?:jaldi|paas|tez|nazdeek)\b/i.test(hindi)) return { type: "COMPARE_OPTIONS" };
      if (/\b(?:jaankari|baare|khula|khuli|pata|details)\b/i.test(hindi)) return { type: "GET_PLACE_DETAILS", reference };
      if (category) return { type: /\b(?:raste (?:mein|me|par)|route (?:pe|par)|raaste (?:mein|me))\b/i.test(hindi) ? "SEARCH_ALONG_ROUTE" : "SEARCH_NEARBY", category };
    }
    if (/\b(?:don't|do not|never|without changing)\b/i.test(clean) && !/\b(?:find|search|show|list|any|nearby|along|what|how)\b/i.test(clean)) return clarify("Your route has not changed. What information would you like?");
    if (/\b(?:(?:other|alternative|alternate|different|another) (?:driving )?routes?|route (?:options|alternatives)|another way|routes? (?:are )?available|available routes?)\b/i.test(clean)) return { type: "GET_ROUTE_ALTERNATIVES" };
    if (/\b(?:traffic|congestion|road closures?|jams?)\b/i.test(clean)) return { type: "GET_TRAFFIC" };
    if (/\b(?:compare|detours?|quickest|fastest|closest|shortest|which (?:one|option) (?:is|takes))\b/i.test(clean) && !/\b(?:find|search|show|any|nearby|nearest)\b/i.test(clean)) return { type: "COMPARE_OPTIONS" };
    if (/\b(?:details?|opening|hours|address|website|ratings?|is .+ open|tell me (?:more )?about|more (?:about|information))\b/i.test(clean) || (reference !== undefined && /\b(?:how far|distance|about|open)\b/i.test(clean))) return { type: "GET_PLACE_DETAILS", reference };
    const along = /\b(?:along|en route|on (?:my|the|our) (?:way|route)|on the way)\b/i.test(clean);
    if (matches.length > 1) return clarify("Please search for one place type at a time, such as restaurants or petrol stations.");
    if (category) return { type: along ? "SEARCH_ALONG_ROUTE" : "SEARCH_NEARBY", category };
    if (/\b(?:are there|is there)(?:\s+any)?[.!?]*$/i.test(clean)) return clarify("What would you like me to check for: petrol stations, restaurants, hospitals, pharmacies, ATMs, or another type of place?");
    if (along && /\b(?:find|search|show|any|what about|how about)\b/i.test(clean)) {
      const previousCategory = context.recentPlaces[0]?.category;
      return previousCategory ? { type: "SEARCH_ALONG_ROUTE", category: previousCategory } : clarify("Which type of place should I search for along your route?");
    }
    if (/\b(?:how long|how much longer|how soon|eta|arrival|time|when.*(?:arrive|reach|get there)|minutes? left)\b/i.test(clean)) return { type: "GET_ETA" };
    if (/\b(?:distance|how far|kilomet(?:er|re)s?|miles|met(?:er|re)s? left)\b/i.test(clean)) return { type: "GET_ROUTE_DISTANCE" };
    if (/\b(?:nearby|near me|places|find|search)\b/i.test(clean)) return clarify("Which type of place would you like: petrol stations, restaurants, hospitals, pharmacies, ATMs, parking, cafes, or EV charging?");
    return clarify("I could not identify one clear place or request. Give the place name or address directly, or say where you want to go. You can also ask about route time, distance, traffic availability, or nearby places. Your destination has not changed.");
  }
}