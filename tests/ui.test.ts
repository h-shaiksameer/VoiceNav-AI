import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { PlaceResults } from "@/components/PlaceResults/PlaceResults";
import { Dashboard } from "@/components/Dashboard";
import { VoiceAssistant } from "@/components/VoiceAssistant/VoiceAssistant";
import { ServiceStatus } from "@/components/ServiceStatus";
import { useNavigationApp } from "@/components/useNavigationApp";
import { serviceAvailability } from "@/services/availability";
import { ConversationEngine } from "@/conversation/ConversationEngine";
import { emptyContext } from "@/conversation/ConversationContext";
import { NavigationController } from "@/navigation/NavigationController";
import type { Location, PlaceResult, RouteResult } from "@/types/domain";

function browser(context: TestContext) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000", pretendToBeVisual: true });
  const globals = { window: dom.window, self: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node };
  const saved = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });
  context.after(() => {
    cleanup();
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return dom.window;
}

test("runtime identity stays stable and conversation searches use the latest selected reference", async (context) => {
  browser(context);
  const centers: { lat: number; lon: number }[] = [];
  context.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    centers.push((JSON.parse(String(init?.body)) as { center: Location }).center);
    return Response.json([]);
  });
  const { result, rerender } = renderHook(() => useNavigationApp());
  const runtime = result.current.runtime;
  const origin: Location = { id: "fixture:origin", name: "Origin", lat: 1, lon: 2 };
  const replacement = { ...origin, id: "fixture:new", lat: 3 };
  act(() => result.current.setOrigin(origin));
  await act(async () => { await runtime.conversation.find("fuel", "nearby"); });
  act(() => result.current.setOrigin(replacement));
  await act(async () => { await runtime.conversation.find("fuel", "nearby"); });
  rerender();
  assert.strictEqual(result.current.runtime, runtime);
  assert.deepEqual(centers.map(({ lat, lon }) => ({ lat, lon })), [{ lat: 1, lon: 2 }, { lat: 3, lon: 2 }]);
  act(() => result.current.setOrigin(null));
  await assert.rejects(runtime.conversation.find("fuel", "nearby"), /Set an origin/);
});

test("runtime preserves successful routes on failure and clears stale places only on a session change", async (context) => {
  browser(context);
  const origin: Location = { id: "fixture:origin", name: "Origin", lat: 1, lon: 2 };
  const destination = { ...origin, id: "fixture:destination", name: "Destination", lat: 2, lon: 3 };
  const place: PlaceResult = { ...origin, id: "fixture:cafe", name: "Cafe", category: "cafe", distanceMeters: 100 };
  const route: RouteResult = { distanceMeters: 100, durationSeconds: 60, geometry: { type: "LineString", coordinates: [[2, 1], [3, 2]] } };
  let routingFailed = false;
  context.mock.method(globalThis, "fetch", async (input: unknown) => String(input) === "/api/places" ? Response.json([place]) : routingFailed ? Response.json({ error: "Routing unavailable" }, { status: 502 }) : Response.json(route));
  const { result } = renderHook(() => useNavigationApp());
  await act(async () => { await result.current.calculateRoute(); });
  assert.match(result.current.routeError, /select an exact/);
  act(() => { result.current.setOrigin(origin); result.current.setDestination(destination); });
  await act(async () => { await result.current.calculateRoute(); });
  const session = result.current.session;
  assert.deepEqual(session.route, route);
  await act(async () => { await result.current.findPlaces(); });
  act(() => result.current.setSelected(place));
  assert.equal(result.current.selected?.id, place.id);
  routingFailed = true;
  await act(async () => { await result.current.calculateRoute(); });
  assert.strictEqual(result.current.session, session);
  assert.match(result.current.routeError, /Routing unavailable/);
  assert.equal(result.current.search?.places.length, 1);
  assert.equal(result.current.working, false);
  await act(async () => { await result.current.stopRoute(); });
  assert.equal(result.current.session.route, null);
  assert.equal(result.current.search, null);
  assert.equal(result.current.selected, null);
  assert.deepEqual(result.current.origin, origin);
  assert.equal(result.current.destination, null);
});

test("service status preserves unknown, outage, recovery and future enhancement labels", (context) => {
  browser(context);
  const initial = serviceAvailability.getServerSnapshot();
  const view = render(createElement(ServiceStatus, { services: initial }));
  assert.equal(view.getAllByText("Not checked yet").length, 3);
  assert.ok(view.getByText("Future Enhancements"));
  assert.ok(view.getByText("Business ratings and verified live opening hours"));
  view.rerender(createElement(ServiceStatus, { services: { ...initial, places: { status: "unavailable", message: "HTTP 502" }, route: { status: "available", message: "Last request succeeded" } } }));
  assert.ok(view.getByText("Temporarily unavailable"));
  assert.ok(view.getByText("HTTP 502"));
  assert.ok(view.getByText("Last request succeeded"));
  view.rerender(createElement(ServiceStatus, { services: { ...initial, places: { status: "available", message: "Last request succeeded" } } }));
  assert.equal(view.queryByText("Temporarily unavailable"), null);
  assert.equal(view.queryByText("HTTP 502"), null);
});

test("Places outage labels availability, disables categories, preserves previous results and allows retry", (context) => {
  browser(context);
  let retries = 0;
  const place: PlaceResult = { id: "osm:1", name: "Previous cafe", category: "cafe", lat: 1, lon: 2, distanceMeters: 500 };
  const props = { category: "cafe" as const, scope: "nearby" as const, search: { category: "cafe" as const, scope: "nearby" as const, places: [place] }, selected: null, detours: [], busy: false, hasRoute: false, error: "HTTP 502", unavailable: "HTTP 502", onCategory: () => {}, onScope: () => {}, onSearch: () => { retries += 1; }, onSelect: () => {}, onNavigate: () => {}, onCompare: () => {} };
  const view = render(createElement(PlaceResults, props));
  assert.ok(view.getByText("Places temporarily unavailable"));
  assert.ok(view.getByText("Previous results are shown below."));
  assert.ok(view.getByText("Previous cafe"));
  assert.equal((view.getByRole("button", { name: "Petrol" }) as HTMLButtonElement).disabled, true);
  fireEvent.click(view.getByRole("button", { name: "Retry place service" }));
  assert.equal(retries, 1);
  view.rerender(createElement(PlaceResults, { ...props, unavailable: undefined, error: "" }));
  assert.equal(view.queryByText("Places temporarily unavailable"), null);
  assert.equal((view.getByRole("button", { name: "Petrol" }) as HTMLButtonElement).disabled, false);
});

test("unavailable Places without results is not presented as an empty successful search", (context) => {
  browser(context);
  const view = render(createElement(PlaceResults, { category: "fuel", scope: "nearby", search: null, selected: null, detours: [], busy: false, hasRoute: false, error: "", unavailable: "Service timed out", onCategory: () => {}, onScope: () => {}, onSearch: () => {}, onSelect: () => {}, onNavigate: () => {}, onCompare: () => {} }));
  assert.ok(view.getByRole("status"));
  assert.equal(view.queryByText("No search results yet"), null);
  assert.equal(view.queryByText("No matching places returned in this area."), null);
});

class Recognition {
  static latest: Recognition;
  lang = "";
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((event: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onspeechstart = null;
  onspeechend = null;
  constructor() { Recognition.latest = this; }
  start() {}
  abort() { this.onend?.(); }
}

test("Allow interruptions displays words, discards drafts, submits turns and survives microphone Stop", async (context) => {
  const window = browser(context);
  Object.assign(window, { SpeechRecognition: Recognition });
  let released = 0;
  const track = { readyState: "live", getSettings: () => ({ echoCancellation: true }), stop: () => { released += 1; } };
  Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) } });
  const route: RouteResult = { distanceMeters: 100, durationSeconds: 60, geometry: { type: "LineString", coordinates: [[2, 1], [3, 2]] } };
  const navigation = new NavigationController(async () => route);
  const engine = new ConversationEngine(navigation, { onPlaces: () => {}, onSelectPlace: () => {}, onDetours: () => {}, getReferenceLocation: () => null });
  const view = render(createElement(VoiceAssistant, { engine, blocked: false, onBusyChange: () => {} }));
  fireEvent.click(view.getByLabelText("Spoken replies"));
  await act(async () => { fireEvent.click(view.getByLabelText("Allow interruptions")); });
  act(() => Recognition.latest.onstart?.());
  const draft = view.getByRole("textbox") as HTMLTextAreaElement;
  const say = (text: string) => Recognition.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  act(() => say("Hitech City"));
  assert.equal(draft.value, "Hitech City");
  assert.equal(engine.getSnapshot().messages.length, 0);
  act(() => say("Hitech City Discard"));
  assert.equal(draft.value, "");
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Stop recording and keep draft" })); });
  assert.equal((view.getByLabelText("Allow interruptions") as HTMLInputElement).checked, true);
  act(() => Recognition.latest.onstart?.());
  await act(async () => say("How far is my destination Submit"));
  assert.ok(engine.getSnapshot().messages.some((message) => message.role === "user" && message.text === "How far is my destination"));
  assert.equal(draft.value, "");
  assert.equal((view.getByLabelText("Allow interruptions") as HTMLInputElement).checked, true);
  act(() => fireEvent.click(view.getByLabelText("Allow interruptions")));
  assert.equal((view.getByLabelText("Allow interruptions") as HTMLInputElement).checked, false);
  assert.ok(released >= 2);
});

test("normal voice mode reopens the microphone after Nova asks for a destination option", async (context) => {
  const window = browser(context);
  Object.assign(window, { SpeechRecognition: Recognition });
  const choices = [{ id: "place:one", name: "First place", lat: 1, lon: 2 }, { id: "place:two", name: "Second place", lat: 1.1, lon: 2.1 }];
  const snapshot = { ...emptyContext(), pendingLocationChoices: choices };
  const engine = { subscribe: () => () => {}, getSnapshot: () => snapshot, getSpokenText: (text: string) => text, send: async () => "I found two options. Say the option." } as unknown as ConversationEngine;
  const view = render(createElement(VoiceAssistant, { engine, blocked: false, onBusyChange: () => {} }));
  const firstRecognition = Recognition.latest;
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Start voice input" })); });
  await act(async () => {
    firstRecognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Navigate to Oxford Send" } }] });
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.equal(engine.getSnapshot().pendingLocationChoices.length, 2);
  assert.notStrictEqual(Recognition.latest, firstRecognition);
  assert.equal(view.getByRole("button", { name: "Stop recording and keep draft" }) !== null, true);
});

test("destination option voice auto-submits after two seconds of silence", async (context) => {
  const window = browser(context);
  Object.assign(window, { SpeechRecognition: Recognition });
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: string[] = [];
  const snapshot = { ...emptyContext(), pendingLocationChoices: [{ id: "place:one", name: "First place", lat: 1, lon: 2 }] };
  const engine = { subscribe: () => () => {}, getSnapshot: () => snapshot, getSpokenText: (text: string) => text, send: async (text: string) => { calls.push(text); return "Selected."; }, clearUiControl: () => {} } as unknown as ConversationEngine;
  const view = render(createElement(VoiceAssistant, { engine, blocked: false, onBusyChange: () => {} }));
  fireEvent.click(view.getByLabelText("Spoken replies"));
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Start voice input" })); });
  Recognition.latest.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "Option one" } }] });
  context.mock.timers.tick(1999);
  assert.deepEqual(calls, []);
  context.mock.timers.tick(1);
  await act(async () => {});
  assert.deepEqual(calls, ["Option one"]);
  assert.ok(view);
});

test("map voice owns a separate microphone turn and does not send navigation text", async (context) => {
  const window = browser(context);
  Object.assign(window, { SpeechRecognition: Recognition });
  const commands: string[] = [];
  const snapshot = emptyContext();
  const engine = { subscribe: () => () => {}, getSnapshot: () => snapshot, getSpokenText: (text: string) => text, clearUiControl: () => {}, executeUiControl: async (text: string) => { commands.push(text); return "Map control applied."; }, send: async () => { throw new Error("Navigation send must not run"); } } as unknown as ConversationEngine;
  const view = render(createElement(VoiceAssistant, { engine, blocked: false, onBusyChange: () => {} }));
  fireEvent.click(view.getByRole("button", { name: "Collapse assistant" }));
  await act(async () => { fireEvent.click(view.getByRole("button", { name: /Map voice disabled/i })); });
  assert.ok(view.getByRole("button", { name: /Map voice enabled/i }));
  const recognition = Recognition.latest;
  assert.ok(recognition);
  await act(async () => {
    recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: "move right" } }] });
  });
  assert.match(view.getByRole("status").textContent ?? "", /move right/);
  await act(async () => {
    recognition.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: "zoom in submit" } }] });
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
  assert.deepEqual(commands, ["zoom in"]);
  assert.ok(view.getByRole("button", { name: /Map voice enabled/i }));
});

test("map sessions open from the hamburger and support create, switch and delete", (context) => {
  browser(context);
  const view = render(createElement(Dashboard));
  fireEvent.click(view.getByRole("button", { name: "Open map sessions" }));
  assert.ok(view.getByRole("complementary", { name: "Map sessions" }));
  fireEvent.click(view.getByRole("button", { name: "+ New session" }));
  fireEvent.click(view.getByRole("button", { name: "+ New session" }));
  const sessionList = view.getByRole("complementary", { name: "Map sessions" }).querySelector(".session-list")!;
  assert.equal(sessionList.querySelectorAll("li").length, 2);
  fireEvent.click(sessionList.querySelector("li button")!);
  assert.equal(sessionList.querySelector("[aria-label='Delete Session 1']")?.getAttribute("aria-label"), "Delete Session 1");
  fireEvent.click(view.getByRole("button", { name: "Delete Session 1" }));
  assert.equal(view.queryByRole("button", { name: /Delete Session 1/ }), null);
  assert.equal(sessionList.querySelectorAll("li").length, 1);
  assert.ok(sessionList.textContent?.includes("Session 2"));
});