export type Coordinates = { lat: number; lon: number };
export type Location = Coordinates & { id: string; name: string; countryCode?: string };
export type TrackedLocation = Location & { accuracyMeters: number; timestamp: number };
export type LocationTrackingStatus = "idle" | "waiting" | "active" | "paused" | "unavailable" | "permission_denied" | "error";
export type PlaceCategory = "fuel" | "restaurant" | "hospital" | "pharmacy" | "atm" | "parking" | "cafe" | "charging_station";
export type PlaceResult = Location & {
  category: PlaceCategory;
  distanceMeters: number;
  address?: string;
  openingHours?: string;
  website?: string;
};
export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
};
export type JourneyStatus = "idle" | "preview" | "ready" | "starting" | "active" | "paused" | "arrived" | "stopped" | "error";
export type NavigationSession = {
  revision: number;
  status: JourneyStatus;
  origin: Location | null;
  destination: Location | null;
  route: RouteResult | null;
};
export type MapCommand = { id: number; action: "zoom-in" | "zoom-out" | "reset" | "center" | "pan-left" | "pan-right" | "pan-up" | "pan-down"; amount?: number; location?: Location };
export type AssistantQueryStatus = "idle" | "running" | "complete" | "cancelled" | "error";
export type AssistantQuerySnapshot = {
  requestId: number;
  status: AssistantQueryStatus;
  query: string;
  answer: string | null;
  error: string | null;
  routeRevision: number;
};
export type UserMessage = { id: string; role: "user"; text: string };
export type AssistantMessage = { id: string; role: "assistant"; text: string; spokenText?: string };
export type Message = UserMessage | AssistantMessage;
export type IntentType = "GET_ETA" | "GET_ROUTE_DISTANCE" | "GET_DISTANCE_BETWEEN" | "GET_TRAFFIC" | "GET_ROUTE_ALTERNATIVES" | "PLAN_ROUTE" | "SEARCH_NEARBY" | "SEARCH_ALONG_ROUTE" | "COMPARE_OPTIONS" | "GET_PLACE_DETAILS" | "CHANGE_DESTINATION" | "STOP_NAVIGATION" | "MAP_ZOOM" | "CLARIFY";
export type Intent = {
  type: IntentType;
  category?: PlaceCategory;
  reference?: number;
  query?: string;
  originQuery?: string;
  clarification?: string;
  mapAction?: "zoom-in" | "zoom-out" | "reset" | "center" | "pan-left" | "pan-right" | "pan-up" | "pan-down";
};
export type NavigationAction =
  | { type: "SET_ROUTE"; origin: Location; destination: Location }
  | { type: "PLAN_ROUTE"; origin: Location; destination: Location; sourceText: string; confirmed: boolean; allowedIds: string[]; expectedRevision: number }
  | { type: "CHANGE_DESTINATION"; destination: Location; sourceText: string; confirmed: boolean; allowedIds: string[]; expectedRevision: number }
  | { type: "STOP_NAVIGATION"; sourceText: string };
export type DetourResult = {
  placeId: string;
  extraDistanceMeters: number;
  extraDurationSeconds: number;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
};
export type ConversationContext = {
  language: "en" | "hi";
  messages: Message[];
  recentPlaces: PlaceResult[];
  selectedPlaceId: string | null;
  lastSearchScope: "nearby" | "route" | null;
  pendingDestination: Location | null;
  pendingOrigin: Location | null;
  pendingLocationChoices: Location[];
  pendingMapAction: "zoom-in" | "zoom-out" | "center" | null;
  pendingSourceText: string | null;
  pendingRevision: number | null;
};