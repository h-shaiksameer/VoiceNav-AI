import assert from "node:assert/strict";
import { test } from "node:test";
import { IntentProcessor } from "@/ai/IntentProcessor";
import { LocalIntentProvider } from "@/ai/providers/LocalIntentProvider";
import { detectLanguage, hindiChoice, hindiConfirmation, hindiDestination, hindiNegation, hindiReferenceText, hindiRoute, hindiStop, normalizeHindi } from "@/ai/language";
import { emptyContext } from "@/conversation/ConversationContext";
import { ambiguousReference, contextualReference, currentLocationReference, destinationInstruction, lastOptionIndex, referenceIndex, routeInstruction, stopInstruction } from "@/navigation/commands";
import { categoryLabel, matchingCategories } from "@/utils/categories";
import { distanceBetween, formatDistance, formatDuration, validCoordinates } from "@/utils/geo";

test("language helpers cover positive, negative, Hindi, and Hinglish forms", () => {
  assert.equal(detectLanguage("hello"), null);
  assert.equal(detectLanguage("मुझे रास्ता दिखाओ"), "hi");
  assert.equal(detectLanguage("Mereko route dikhao"), "hi");
  assert.match(normalizeHindi("मेरेको १२ मंज़िल।"), /mereko 12 manzil\./);
  assert.equal(hindiNegation("Mereko wahan nakko leke chalo"), true);
  assert.equal(hindiNegation("Mereko wahan leke chalo"), false);
  assert.equal(hindiDestination("Mereko Charminar leke chalo"), "Charminar");
  assert.equal(hindiDestination("Destination Charminar kardo"), "Charminar");
  assert.equal(hindiDestination("Mereko wahan leke chalo"), "there");
  assert.equal(hindiDestination("Mereko ghar leke chalo"), null);
  assert.equal(hindiDestination("Mereko Charminar? leke chalo"), null);
  assert.deepEqual(hindiRoute("Mereko Hyderabad se Charminar tak route dikhao"), { originQuery: "Hyderabad", query: "Charminar" });
  assert.equal(hindiRoute("Mereko Hyderabad se Charminar tak route dikhao nakko"), null);
  assert.equal(hindiStop("Route band karo"), true);
  assert.equal(hindiStop("Route band karo nakko"), false);
  assert.equal(hindiConfirmation("haan"), "yes");
  assert.equal(hindiConfirmation("nakko"), "no");
  assert.equal(hindiConfirmation("maybe"), null);
  assert.equal(hindiChoice("option two"), true);
  assert.equal(hindiChoice("maybe two"), false);
  assert.equal(hindiReferenceText("दूसरे वाले"), "second one");
});

test("navigation command helpers cover labelled, reverse, negative, and contextual forms", () => {
  assert.deepEqual(routeInstruction("Set starting location as A and target location as B"), { originQuery: "A", query: "B" });
  assert.deepEqual(routeInstruction("Navigate to B from A"), { originQuery: "A", query: "B" });
  assert.equal(routeInstruction("Plan a route from A to B and then stop"), null);
  assert.equal(currentLocationReference("my current GPS location"), true);
  assert.equal(currentLocationReference("somewhere"), false);
  assert.equal(destinationInstruction("Please navigate to Charminar"), "Charminar");
  assert.equal(destinationInstruction("Take me there"), "there");
  assert.equal(destinationInstruction("Navigate to A or B"), null);
  assert.equal(stopInstruction("Please stop my route"), true);
  assert.equal(stopInstruction("Don't stop navigation"), false);
  assert.equal(lastOptionIndex("choose option 12"), 11);
  assert.equal(lastOptionIndex("which option?"), undefined);
  assert.equal(referenceIndex("result 3"), 2);
  assert.equal(ambiguousReference("first and second"), true);
  const context = { ...emptyContext(), recentPlaces: [{ id: "a", name: "A", lat: 1, lon: 1, category: "cafe" as const, distanceMeters: 1 }] };
  assert.equal(contextualReference("Take me there", context), 0);
  assert.equal(contextualReference("Take me there", emptyContext()), undefined);
});

test("local intent and utility helpers cover uncommon categories and geometry boundaries", async () => {
  const provider = new LocalIntentProvider();
  for (const phrase of ["Mereko traffic batao", "Mereko doosra rasta dikhao", "Mereko compare batao", "Mereko route ki jaankari batao", "Mereko raste mein cafe dikhao", "Are there any?"]) {
    assert.ok((await provider.process({ text: phrase, context: emptyContext(), session: { revision: 0, status: "idle", origin: null, destination: null, route: null } })).type);
  }
  const processor = new IntentProcessor();
  assert.equal((await processor.process({ text: "Find restaurants or petrol stations", context: emptyContext(), session: { revision: 0, status: "idle", origin: null, destination: null, route: null } })).type, "CLARIFY");
  assert.equal(matchingCategories("fuel food hospital pharmacy atm parking coffee charging").length, 8);
  assert.equal(categoryLabel("not-a-category" as never), "not-a-category");
  assert.equal(validCoordinates({ lat: -90, lon: 180 }), true);
  assert.equal(validCoordinates({ lat: 90.1, lon: 0 }), false);
  assert.equal(distanceBetween({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }) > 20_000_000, true);
  assert.equal(formatDistance(1000), "1.0 km");
  assert.equal(formatDuration(3600), "1 hr 0 min");
});