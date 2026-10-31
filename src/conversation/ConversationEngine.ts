import type { ConversationContext, DetourResult, Location, PlaceCategory, PlaceResult, RouteResult } from "@/types/domain";
import { NavigationController } from "@/navigation/NavigationController";
import { IntentProcessor } from "@/ai/IntentProcessor";
import { categoryLabel } from "@/utils/categories";
import { distanceBetween, formatDistance, formatDuration } from "@/utils/geo";
import { currentLocationReference, destinationInstruction, lastOptionIndex, normalizeLanguage, routeInstruction } from "@/navigation/commands";
import { HINDI_VOICE_SEND_PHRASE, VOICE_SEND_PHRASE, voiceRequest } from "@/services/voice/browserVoice";
import { locationSchema } from "@/types/schemas";
import { detectLanguage, hindiConfirmation, type AssistantLanguage } from "@/ai/language";
import { addMessage, clearPendingNavigation, emptyContext } from "./ConversationContext";
import { defaultConversationServices, type ConversationServices } from "./ConversationServices";

export type PlaceSearch = { category: PlaceCategory; scope: "nearby" | "route"; places: PlaceResult[] };
type Callbacks = {
  onPlaces: (search: PlaceSearch) => void;
  onSelectPlace: (place: PlaceResult | null) => void;
  onDetours: (results: DetourResult[]) => void;
  onAlternatives?: (routes: RouteResult[]) => void;
  getReferenceLocation: () => Location | null;
  getCurrentLocation?: () => Promise<Location>;
  onCurrentLocation?: (location: Location) => void;
};

export class ConversationEngine {
  private context = emptyContext();
  private listeners = new Set<() => void>();
  private busy = false;
  private readonly processor = new IntentProcessor();

  constructor(
    private readonly navigation: NavigationController,
    private readonly callbacks: Callbacks,
    private readonly services: ConversationServices = defaultConversationServices,
  ) {
    navigation.subscribe(() => this.resetNavigationContext());
  }

  getSnapshot = (): ConversationContext => this.context;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(context: ConversationContext) { this.context = context; this.listeners.forEach((listener) => listener()); }
  private reply(text: string): string {
    const choices = this.context.pendingLocationChoices;
    const spokenText = this.getSpokenText(choices.length && text === this.locationChoicesText(choices) ? this.locationChoicesText(choices, true) : text);
    this.update(addMessage(this.context, "assistant", text, spokenText));
    return text;
  }
  getSpokenText(text: string): string {
    const session = this.navigation.getSnapshot();
    const locations = [session.origin, session.destination, this.context.pendingOrigin, this.context.pendingDestination, ...this.context.pendingLocationChoices, ...this.context.recentPlaces];
    const labels = locations.flatMap((location) => location ? [location.name, ...("address" in location && typeof location.address === "string" ? [location.address] : [])] : []);
    let spoken = text;
    for (const label of [...new Set(labels)].sort((first, second) => second.length - first.length)) {
      const short = label.trim().split(/\s+/u).slice(0, 5).join(" ");
      if (label.trim().split(/\s+/u).length > 5) spoken = spoken.replaceAll(label, short);
    }
    return spoken
      .replaceAll(` followed by ${VOICE_SEND_PHRASE}`, "")
      .replaceAll(`विकल्प के नंबर के बाद ${HINDI_VOICE_SEND_PHRASE} बोलिए`, "विकल्प का नंबर बोलिए")
      .replaceAll(`हाँ या नक्को के बाद ${HINDI_VOICE_SEND_PHRASE} बोलिए`, "हाँ या नक्को बोलिए");
  }
  setLanguage(language: AssistantLanguage): void { this.update({ ...this.context, language }); }
  private say(english: string, hindi: string): string { return this.context.language === "hi" ? hindi : english; }
  private duration(seconds: number): string { return this.context.language === "hi" ? formatDuration(seconds).replace(/hr/g, "घंटे").replace(/min/g, "मिनट") : formatDuration(seconds); }
  private distance(meters: number): string { return this.context.language === "hi" ? formatDistance(meters).replace(/km/g, "किलोमीटर").replace(/m/g, "मीटर") : formatDistance(meters); }
  private shortLocationName(location: Location): string { return location.name.trim().split(/\s+/u).slice(0, 3).join(" "); }
  private clearPending() { this.update(clearPendingNavigation(this.context)); }

  resetNavigationContext(): void {
    this.update(clearPendingNavigation({ ...this.context, recentPlaces: [], selectedPlaceId: null, lastSearchScope: null }));
  }

  selectPlace(place: PlaceResult | null): void {
    const resolved = place ? this.context.recentPlaces.find((item) => item.id === place.id) : null;
    if (place && !resolved) throw new Error("This place is not in the latest search results.");
    this.update({ ...this.context, selectedPlaceId: resolved?.id ?? null });
    this.callbacks.onSelectPlace(resolved ?? null);
  }

  async find(category: PlaceCategory, scope: "nearby" | "route"): Promise<PlaceResult[]> {
    const session = this.navigation.getSnapshot();
    const reference = session.origin ?? this.callbacks.getReferenceLocation();
    if (!reference) throw new Error("Set an origin or allow location access before searching for places.");
    if (scope === "route" && !session.route) throw new Error("Calculate a route before searching along it.");
    const places = await this.services.searchPlaces(category, reference, scope, session.route?.geometry);
    if (this.navigation.getSnapshot().revision !== session.revision) throw new Error("Your route changed during the search. Please search again.");
    this.update(clearPendingNavigation({ ...this.context, recentPlaces: places, selectedPlaceId: null, lastSearchScope: scope }));
    this.callbacks.onPlaces({ category, scope, places });
    return places;
  }

  async compare(): Promise<string> {
    const session = this.navigation.getSnapshot();
    const places = this.context.recentPlaces.slice(0, 3);
    if (!places.length) throw new Error("Search for places first, then compare the results.");
    if (!session.origin || !session.destination || !session.route) {
      const distances = places.map((place) => `${place.name}: ${formatDistance(place.distanceMeters)} ${this.context.lastSearchScope === "route" ? "from the route" : "straight line from the search origin"}`);
      return this.say(`Compared returned places: ${distances.join("; ")}. Driving detours are not available without an active route. Your destination is unchanged.`, `शुरुआती जगह${this.context.lastSearchScope === "route" ? " के बजाय रास्ते" : ""} से सीधी दूरी: ${places.map((place) => `${place.name}: ${this.distance(place.distanceMeters)}`).join("। ")}। ड्राइविंग की तुलना के लिए पहले रास्ता बनाइए। मंज़िल नहीं बदली है।`);
    }
    const results: DetourResult[] = [];
    const failures: string[] = [];
    for (const place of places) {
      try {
        const route = await this.services.requestRoute([session.origin, place, session.destination]);
        results.push({ placeId: place.id, extraDistanceMeters: route.distanceMeters - session.route.distanceMeters, extraDurationSeconds: route.durationSeconds - session.route.durationSeconds, totalDistanceMeters: route.distanceMeters, totalDurationSeconds: route.durationSeconds });
      } catch { failures.push(place.name); }
    }
    if (this.navigation.getSnapshot().revision !== session.revision) throw new Error("Your route changed during comparison. Please compare again.");
    this.callbacks.onDetours(results);
    const summaries = results.map((result) => {
      const place = places.find((item) => item.id === result.placeId)!;
      const delta = result.extraDurationSeconds;
      return `${place.name}: ${formatDuration(result.totalDurationSeconds)} total, ${Math.abs(Math.round(delta / 60))} min ${delta < 0 ? "less" : "extra"} driving`;
    });
    if (!results.length) throw new Error("Detours could not be calculated. Please retry later. Your route is unchanged.");
    return this.say(`Compared ${results.length} of the first ${places.length} results using OSRM: ${summaries.join("; ")}. Stops and traffic are not included.${failures.length ? ` Detour not available for ${failures.join(", ")}.` : ""} Your destination is unchanged.`, `${results.length} जगहों के लिए OSRM से ड्राइविंग की तुलना की है। ${results.map((result) => `${places.find((place) => place.id === result.placeId)!.name}: कुल ${this.duration(result.totalDurationSeconds)}, ${Math.abs(Math.round(result.extraDurationSeconds / 60))} मिनट ${result.extraDurationSeconds < 0 ? "कम" : "ज़्यादा"}`).join("। ")}। रुकने का समय और ट्रैफिक शामिल नहीं हैं।${failures.length ? ` ${failures.join(", ")} के लिए तुलना उपलब्ध नहीं है।` : ""} मंज़िल नहीं बदली है।`);
  }

  private async checkOtherRoutes(): Promise<string> {
    const session = this.navigation.getSnapshot();
    if (!session.origin || !session.destination || !session.route) return this.say("Which journey should I check? Select an origin and destination and calculate a route first, then I can request other driving routes between them.", "दूसरे रास्ते देखने के लिए पहले शुरुआती जगह और मंज़िल बताकर रास्ता बनाइए।");
    const routes = await this.services.requestRouteAlternatives([session.origin, session.destination]);
    if (this.navigation.getSnapshot().revision !== session.revision) throw new Error("Your journey changed while checking other routes. Please ask again.");
    const seen = new Set([JSON.stringify(session.route.geometry.coordinates)]);
    const alternatives = routes.filter((route) => {
      const signature = JSON.stringify(route.geometry.coordinates);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
    this.callbacks.onAlternatives?.(alternatives);
    if (!alternatives.length) return this.say("OSRM did not return another driving route for this journey. Your current route and destination are unchanged. This does not guarantee that no other roads exist.", "OSRM से इस सफ़र का दूसरा रास्ता नहीं मिला। इसका मतलब यह नहीं कि कोई और सड़क है ही नहीं। आपका रास्ता और मंज़िल वही हैं।");
    const summaries = alternatives.map((route, index) => `Option ${index + 1}: ${formatDuration(route.durationSeconds)}, ${formatDistance(route.distanceMeters)}`);
    return this.say(`I found ${alternatives.length} other driving ${alternatives.length === 1 ? "route" : "routes"}. ${summaries.join(". ")}. These are previews without live traffic. Your current route and destination are unchanged.`, `${alternatives.length} दूसरे रास्ते मिले हैं। ${alternatives.map((route, index) => `विकल्प ${index + 1}: ${this.duration(route.durationSeconds)}, ${this.distance(route.distanceMeters)}`).join("। ")}। ये लाइव ट्रैफिक के बिना प्रीव्यू हैं। आपका रास्ता और मंज़िल नहीं बदले हैं।`);
  }

  private propose(destination: Location, sourceText: string, expectedRevision: number, origin: Location | null = null): string {
    if (!destinationInstruction(sourceText) && !routeInstruction(sourceText)) throw new Error("An explicit navigation instruction is required.");
    const session = this.navigation.getSnapshot();
    if (!session.origin && !origin) throw new Error("A starting location is required for this route.");
    if (session.revision !== expectedRevision) throw new Error("Your route changed while resolving the destination. Please ask again.");
    this.update({ ...this.context, pendingDestination: destination, pendingOrigin: origin, pendingLocationChoices: [], pendingSourceText: sourceText, pendingRevision: session.revision });
    const originName = origin?.id === "device:current" ? this.say("current location", "आपकी मौजूदा जगह") : origin?.name;
    return origin ? this.say(`Plan a driving route from ${originName} to ${destination.name}? Say confirm route or cancel, followed by ${VOICE_SEND_PHRASE}. Your current route has not changed.`, `${originName} से ${destination.name} तक का रास्ता बनाऊँ? हाँ या नक्को के बाद ${HINDI_VOICE_SEND_PHRASE} बोलिए। अभी रास्ता नहीं बदला है।`) : this.say(`Change your destination to ${destination.name}? Say confirm destination or cancel, followed by ${VOICE_SEND_PHRASE}. Your current route has not changed.`, `क्या मंज़िल ${destination.name} कर दूँ? हाँ या नक्को के बाद ${HINDI_VOICE_SEND_PHRASE} बोलिए। अभी रास्ता नहीं बदला है।`);
  }

  private locationChoicesText(choices: Location[], spoken = false): string {
    if (spoken) return "Say the option.";
    const names = choices.map((location) => location.name);
    const order = "nearest first by straight-line distance from your starting location";
    const hindiOrder = "शुरुआती जगह से सीधी दूरी के हिसाब से पास वाली पहले";
    return this.say(`I found ${choices.length} destination matches, ${order}. ${names.map((name, index) => `Option ${index + 1}: ${name}`).join(". ")}. Say the option number. I will process it after three seconds. I have not changed your route.`, `${choices.length} जगहें मिली हैं, ${hindiOrder} है। ${names.map((name, index) => `विकल्प ${index + 1}: ${name}`).join("। ")}। विकल्प का नंबर बोलिए। तीन सेकंड बाद इसे प्रोसेस करूँगा। अभी रास्ता नहीं बदला है।`);
  }

  private async resolveDestinations(locations: Location[], sourceText: string, revision: number, origin: Location | null): Promise<string> {
    if (this.navigation.getSnapshot().revision !== revision) throw new Error("Your journey changed during address search. Please ask again.");
    const reference = origin ?? this.navigation.getSnapshot().origin ?? this.callbacks.getReferenceLocation();
    const matches = locations.filter((location) => !reference?.countryCode || location.countryCode === reference.countryCode);
    if (!matches.length) throw new Error("No matching destination was found in the starting location's country. Give a more specific name or address. Your route is unchanged.");
    if (matches.length === 1) {
      const proposal = this.propose(matches[0], sourceText, revision, origin);
      return origin ? this.commitPending() : proposal;
    }
    const choices = [...matches].sort((first, second) => reference ? distanceBetween(reference, first) - distanceBetween(reference, second) : 0).slice(0, 5);
    this.update({ ...this.context, pendingDestination: null, pendingOrigin: origin, pendingLocationChoices: choices, pendingSourceText: sourceText, pendingRevision: revision });
    return this.locationChoicesText(choices);
  }

  private async planRoute(originQuery: string, query: string, sourceText: string, revision: number): Promise<string> {
    let origin: Location;
    if (currentLocationReference(originQuery)) {
      origin = locationSchema.parse(await (this.callbacks.getCurrentLocation?.() ?? this.services.requestCurrentLocation()));
      this.callbacks.onCurrentLocation?.(origin);
    } else {
      const origins = await this.services.searchLocations(originQuery);
      if (origins.length !== 1) return origins.length ? "That starting location has multiple matches. Repeat the route request with a more specific starting address and destination." : "I could not find that starting location. Give a more specific starting address and destination.";
      origin = origins[0];
    }
    return this.resolveDestinations(await this.services.searchLocations(query, origin), sourceText, revision, origin);
  }

  private selectLocation(index: number): void {
    const { pendingLocationChoices, pendingSourceText, pendingRevision, pendingOrigin } = this.context;
    const destination = pendingLocationChoices[index];
    if (!destination || !pendingSourceText || pendingRevision === null) throw new Error("That option is not in the current destination choices. Say a listed option number.");
    this.propose(destination, pendingSourceText, pendingRevision, pendingOrigin);
  }

  async chooseLocation(index: number): Promise<string> {
    if (this.busy) throw new Error("Please wait for the current request to finish.");
    this.busy = true;
    try {
      this.selectLocation(index);
      return await this.commitPending();
    } finally { this.busy = false; }
  }

  private async commitPending(): Promise<string> {
    const { pendingDestination, pendingOrigin, pendingSourceText, pendingRevision } = this.context;
    if (!pendingDestination || !pendingSourceText) throw new Error("There is no destination change to confirm.");
    if (pendingRevision !== this.navigation.getSnapshot().revision) { this.clearPending(); throw new Error("Your journey changed. Please ask again."); }
    const common = { destination: pendingDestination, sourceText: pendingSourceText, confirmed: true, allowedIds: [pendingDestination.id], expectedRevision: pendingRevision };
    await this.navigation.execute(pendingOrigin ? { type: "PLAN_ROUTE", origin: pendingOrigin, ...common } : { type: "CHANGE_DESTINATION", ...common });
    this.clearPending();
    const route = this.navigation.getSnapshot().route;
    return this.reply(this.say(`${pendingOrigin ? "Route ready" : "Destination changed"}: ${pendingDestination.name}.${route ? ` Estimated driving time ${formatDuration(route.durationSeconds)}, distance ${formatDistance(route.distanceMeters)}. No live traffic or turn-by-turn guidance.` : ""}`, `${pendingDestination.name} तक का रास्ता तैयार है।${route ? ` अनुमानित समय ${this.duration(route.durationSeconds)}, दूरी ${this.distance(route.distanceMeters)}। लाइव ट्रैफिक और मोड़-दर-मोड़ निर्देश उपलब्ध नहीं हैं।` : ""}`));
  }

  async confirm(): Promise<string> {
    if (this.busy) throw new Error("Please wait for the current request to finish.");
    this.busy = true;
    try {
      return await this.commitPending();
    } finally { this.busy = false; }
  }

  cancel(message = "Destination change cancelled. Your current route is unchanged.", spokenMessage = "ठीक है, बदलाव रद्द कर दिया। आपका पुराना रास्ता वही है।"): string { this.clearPending(); return this.reply(this.say(message, spokenMessage)); }

  async send(text: string): Promise<string> {
    if (this.busy) throw new Error("Please wait for the current request to finish.");
    const request = normalizeLanguage(voiceRequest(text) ?? text);
    const selectedOption = lastOptionIndex(request);
    const clean = request.slice(0, 500);
    if (!clean) return "";
    const detected = detectLanguage(clean);
    if (detected) this.setLanguage(detected);
    this.busy = true;
    this.update(addMessage(this.context, "user", clean));
    try {
      const shortReply = clean.replace(/[,!.?]+/g, " ").replace(/\s+/g, " ").trim();
      const hindiAnswer = hindiConfirmation(clean);
      if (hindiAnswer === "yes" || /^(?:yes(?: please| confirm(?: (?:the )?(?:route|destination))?| go ahead)?|confirm(?: (?:the )?(?:route|destination))?|go ahead)$/i.test(shortReply)) {
        if (this.context.pendingDestination) return await this.commitPending();
        if (this.context.pendingLocationChoices.length) return this.reply(this.say("Which destination match? Say option one, option two, or another listed option number.", "कौन सी जगह? विकल्प एक, विकल्प दो, या सूची का नंबर बोलिए।"));
        return this.reply(this.say("There is no route change awaiting confirmation. Give a destination or a route request first.", "अभी कोई रास्ता कन्फर्म करने के लिए नहीं है। पहले मंज़िल या रास्ता बताइए।"));
      }
      if ((hindiAnswer === "no" || /^(?:no(?: thanks| thank you)?|cancel|cancel (?:route|destination)|never mind)$/i.test(shortReply)) && (this.context.pendingDestination || this.context.pendingLocationChoices.length)) return this.cancel();
      if (this.context.pendingLocationChoices.length && selectedOption !== undefined) {
        this.selectLocation(selectedOption);
        return await this.commitPending();
      }
      if (this.context.pendingLocationChoices.length) return this.reply(this.say("That was not one of the listed options. Say option one, option two, or another listed option number.", "यह सूची में दिया गया विकल्प नहीं है। विकल्प एक, विकल्प दो, या सूची का कोई दूसरा नंबर बोलिए।"));
      const session = this.navigation.getSnapshot();
      const intent = await this.processor.process({ text: clean, context: this.context, session });
      if (["PLAN_ROUTE", "CHANGE_DESTINATION", "STOP_NAVIGATION", "SEARCH_NEARBY", "SEARCH_ALONG_ROUTE"].includes(intent.type)) this.clearPending();
      let response: string;
      switch (intent.type) {
        case "PLAN_ROUTE":
          if (!intent.originQuery || !intent.query) throw new Error("Give both a starting location and a destination.");
          response = await this.planRoute(intent.originQuery, intent.query, clean, session.revision);
          break;
        case "GET_ETA":
          response = session.route ? this.say(`The current route to ${session.destination?.name} has an estimated driving time of ${formatDuration(session.route.durationSeconds)}. This is a static route estimate, not live remaining time or traffic.`, `${session.destination?.name} तक अनुमानित समय ${this.duration(session.route.durationSeconds)} है। यह पूरे रास्ते का अनुमान है, लाइव बचा हुआ समय या ट्रैफिक नहीं।`) : this.say("Calculate a route first to see the estimated driving time.", "पहले शुरुआती जगह और मंज़िल बताकर रास्ता बनाइए, फिर समय बता सकूँगा।");
          break;
        case "GET_ROUTE_DISTANCE":
          response = session.route ? this.say(`The current driving route is ${formatDistance(session.route.distanceMeters)}. Your destination is unchanged.`, `रास्ते की दूरी ${this.distance(session.route.distanceMeters)} है। मंज़िल नहीं बदली है।`) : this.say("Calculate a route first to see its distance.", "दूरी बताने के लिए पहले रास्ता बनाइए।");
          break;
        case "GET_DISTANCE_BETWEEN":
          if (!intent.originQuery || !intent.query) throw new Error("Give both locations to measure their distance.");
          response = await this.distanceBetweenLocations(intent.originQuery, intent.query, session.revision);
          break;
        case "GET_TRAFFIC":
          response = this.say("Live traffic is not available. OSRM estimates do not account for current congestion or road closures.", "लाइव ट्रैफिक की जानकारी उपलब्ध नहीं है। समय के अनुमान में मौजूदा जाम या बंद सड़कें शामिल नहीं हैं।");
          break;
        case "GET_ROUTE_ALTERNATIVES": response = await this.checkOtherRoutes(); break;
        case "SEARCH_NEARBY":
        case "SEARCH_ALONG_ROUTE": {
          if (!intent.category) throw new Error("Which type of place would you like to find?");
          const scope = intent.type === "SEARCH_ALONG_ROUTE" ? "route" : "nearby";
          const places = await this.find(intent.category, scope);
          response = places.length ? this.say(`Found ${places.length} ${categoryLabel(intent.category).toLowerCase()} ${scope === "route" ? "within about 1.5 km of your route" : "within 5 km of your origin"}. Results are numbered in the places panel. Your destination is unchanged.`, `${places.length} जगहें मिली हैं, ${scope === "route" ? "रास्ते से लगभग डेढ़ किलोमीटर के अंदर" : "शुरुआती जगह से पाँच किलोमीटर के अंदर"}। ${places.slice(0, 3).map((place, index) => `विकल्प ${index + 1}: ${place.name}`).join("। ")}। मंज़िल नहीं बदली है।`) : this.say("No matching OpenStreetMap places were returned in this area. Your destination is unchanged.", "इस इलाके में OpenStreetMap से ऐसी कोई जगह नहीं मिली। मंज़िल नहीं बदली है।");
          break;
        }
        case "COMPARE_OPTIONS": response = await this.compare(); break;
        case "GET_PLACE_DETAILS": {
          const index = intent.reference ?? (this.context.recentPlaces.length === 1 ? 0 : undefined);
          const place = index === undefined ? undefined : this.context.recentPlaces[index];
          if (!place) { response = this.say("Which result? Specify a result number from the most recent places search.", "कौन सा नतीजा? पिछली खोज का विकल्प नंबर बताइए।"); break; }
          this.selectPlace(place);
          response = this.say(`${place.name}. ${formatDistance(place.distanceMeters)} ${this.context.lastSearchScope === "route" ? "from the route corridor" : "in a straight line from the search origin"}. Address: ${place.address || "Not available"}. Opening hours (OSM, not verified live): ${place.openingHours || "Not available"}. Ratings: Not available. Driving detour requires a route comparison.`, `${place.name}। ${this.context.lastSearchScope === "route" ? "रास्ते से दूरी" : "शुरुआती जगह से सीधी दूरी"} ${this.distance(place.distanceMeters)}। पता: ${place.address || "उपलब्ध नहीं"}। खुलने का समय: ${place.openingHours || "उपलब्ध नहीं"}। यह लाइव जाँची गई जानकारी नहीं है। रेटिंग उपलब्ध नहीं है।`);
          break;
        }
        case "CHANGE_DESTINATION": {
          if (!session.origin && intent.query && intent.reference === undefined && !intent.category) {
            const startingLocation = this.callbacks.getReferenceLocation();
            response = startingLocation
              ? await this.resolveDestinations(await this.services.searchLocations(intent.query, startingLocation), clean, session.revision, startingLocation)
              : await this.planRoute("current location", intent.query, clean, session.revision);
            break;
          }
          if (!session.origin) throw new Error("Give a starting location and destination, for example plan a route from current location to a specific address.");
          let selected: Location | undefined;
          if (intent.reference !== undefined) {
            const place = this.context.recentPlaces[intent.reference];
            if (!place || (intent.category && place.category !== intent.category)) { response = "That result cannot be identified in the latest search. Search again or give a valid result number."; break; }
            selected = place;
          } else if (intent.category && /\b(?:nearest|closest)\b/i.test(intent.query ?? "")) {
            const places = await this.find(intent.category, "nearby");
            selected = places[0];
            if (!selected) { response = "No matching places were returned nearby. Your destination is unchanged."; break; }
          } else {
            const query = intent.query ?? "";
            if (/^(?:(?:the|that|this)\s+)?(?:one|place|it|there|here|restaurant|petrol station|hospital|atm)$/i.test(query) || /^(?:my )?(?:home|work)$/i.test(query)) {
              response = "That destination is ambiguous. Give a specific address or a numbered search result. Saved home and work addresses are not configured."; break;
            }
            const matches = this.context.recentPlaces.filter((place) => place.name.toLowerCase() === query.toLowerCase());
            if (matches.length === 1) selected = matches[0];
            else if (matches.length > 1) { response = "Several results have that name. Specify the result number."; break; }
            else {
              const locations = await this.services.searchLocations(query, session.origin);
              response = await this.resolveDestinations(locations, clean, session.revision, null);
              break;
            }
          }
          if (!selected) throw new Error("A valid destination could not be resolved. Your route is unchanged.");
          response = this.propose(selected, clean, session.revision);
          if (intent.category && /\b(?:nearest|closest)\b/i.test(intent.query ?? "")) response += " This is the closest returned result by straight-line distance from the route origin, not driving time. Public map results may be incomplete.";
          break;
        }
        case "STOP_NAVIGATION":
          await this.navigation.execute({ type: "STOP_NAVIGATION", sourceText: clean });
          this.callbacks.onDetours([]);
          response = this.say("Route preview cleared. No background GPS navigation was running.", "रास्ते का प्रीव्यू बंद कर दिया। बैकग्राउंड में लाइव GPS नेविगेशन नहीं चल रहा था।");
          break;
        default: response = this.context.language === "hi" ? (intent.clarification && /[\u0900-\u097f]/u.test(intent.clarification) ? intent.clarification : "बात पूरी तरह समझ नहीं आई। जगह का नाम, विकल्प नंबर, समय या दूरी पूछिए। मंज़िल नहीं बदली है।") : intent.clarification || "I could not identify that request. Specify a place type, a numbered search result, a route question, or one explicit destination change. Your route has not changed.";
      }
      return this.reply(response);
    } catch (error) {
      this.reply(error instanceof Error ? error.message : "The request could not be completed. Your route is unchanged.");
      throw error;
    } finally { this.busy = false; }
  }

  private async distanceBetweenLocations(originQuery: string, destinationQuery: string, revision: number): Promise<string> {
    const session = this.navigation.getSnapshot();
    const reference = session.origin ?? this.callbacks.getReferenceLocation() ?? undefined;
    const origins = await this.services.searchLocations(originQuery, reference);
    if (!origins.length) return this.say(`I could not find ${originQuery}. Your current route and destination are unchanged.`, `${originQuery} नहीं मिला। आपका मौजूदा रास्ता और मंज़िल वही हैं।`);
    const origin = origins[0];
    const destinations = await this.services.searchLocations(destinationQuery, origin);
    if (!destinations.length) return this.say(`I could not find ${destinationQuery}. Your current route and destination are unchanged.`, `${destinationQuery} नहीं मिला। आपका मौजूदा रास्ता और मंज़िल वही हैं।`);
    const destination = destinations[0];
    const route = await this.services.requestRoute([origin, destination]);
    if (this.navigation.getSnapshot().revision !== revision) throw new Error("Your journey changed while checking that distance. Please ask again.");
    const originName = this.shortLocationName(origin);
    const destinationName = this.shortLocationName(destination);
    return this.say(`The driving distance between ${originName} and ${destinationName} is ${formatDistance(route.distanceMeters)}.`, `${originName} और ${destinationName} के बीच ड्राइविंग दूरी ${this.distance(route.distanceMeters)} है।`);
  }
}