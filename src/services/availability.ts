export type ServiceName = "geocode" | "route" | "places";
export type ServiceAvailability = { status: "unknown" | "available" | "unavailable"; message: string };
const listeners = new Set<() => void>();
const initial: Record<ServiceName, ServiceAvailability> = {
  geocode: { status: "unknown", message: "Not checked yet" },
  route: { status: "unknown", message: "Not checked yet" },
  places: { status: "unknown", message: "Not checked yet" },
};
let snapshot = initial;

export const serviceAvailability = {
  getSnapshot: () => snapshot,
  getServerSnapshot: () => initial,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
};

export function reportServiceResult(service: ServiceName, available: boolean, message = "Last request succeeded"): void {
  const status = available ? "available" : "unavailable";
  if (snapshot[service].status === status && snapshot[service].message === message) return;
  snapshot = { ...snapshot, [service]: { status, message } };
  listeners.forEach((listener) => listener());
}