import type { Coordinates, Location, NavigationAction, NavigationSession, RouteResult } from "@/types/domain";
import { locationSchema, navigationActionSchema, routeSchema } from "@/types/schemas";
import { ambiguousReference, destinationInstruction, routeInstruction, stopInstruction } from "./commands";
import { emptySession } from "./NavigationSession";

type RouteService = (points: Coordinates[]) => Promise<RouteResult>;

export class NavigationController {
  private session: NavigationSession = emptySession();
  private listeners = new Set<() => void>();
  private requestId = 0;

  constructor(private readonly routeService: RouteService) {}

  getSnapshot = (): NavigationSession => this.session;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(session: NavigationSession) {
    this.session = session;
    this.listeners.forEach((listener) => listener());
  }

  async execute(action: NavigationAction): Promise<NavigationSession> {
    const validation = navigationActionSchema.safeParse(action);
    if (!validation.success) throw new Error("Invalid navigation action. Confirm a valid destination and try again.");
    action = validation.data;
    if (action.type === "STOP_NAVIGATION") {
      if (!stopInstruction(action.sourceText)) throw new Error("An explicit stop instruction is required.");
      this.requestId += 1;
      this.publish({ ...emptySession(), revision: this.session.revision + 1 });
      return this.session;
    }
    const destination = locationSchema.parse(action.destination);
    if (action.type === "CHANGE_DESTINATION" || action.type === "PLAN_ROUTE") {
      const plan = action.type === "PLAN_ROUTE" ? routeInstruction(action.sourceText) : null;
      if (!plan && !destinationInstruction(action.sourceText)) throw new Error("Only an explicit navigation instruction can change the destination.");
      if (!plan && ambiguousReference(action.sourceText)) throw new Error("Specify a single result before changing the destination.");
      if (!action.confirmed) throw new Error("Confirm the destination change first.");
      if (!action.allowedIds.includes(destination.id)) throw new Error("This place is not one of the resolved navigation options.");
      if (action.expectedRevision !== this.session.revision) throw new Error("The active route changed. Request and confirm the destination again.");
    }
    const origin = locationSchema.parse(action.type === "SET_ROUTE" || action.type === "PLAN_ROUTE" ? action.origin : this.session.origin);
    const requestId = ++this.requestId;
    const route = routeSchema.parse(await this.routeService([origin, destination]));
    if (requestId !== this.requestId) throw new Error("This request was superseded. The latest navigation choice has been kept.");
      this.publish({ revision: this.session.revision + 1, status: "ready", origin, destination, route });
    return this.session;
  }

  async recalculateJourney(origin: Location): Promise<NavigationSession> {
    if (!this.session.destination || !this.session.route || !["active", "paused"].includes(this.session.status)) throw new Error("An active or paused journey is required to recalculate.");
    const requestId = ++this.requestId;
    const route = routeSchema.parse(await this.routeService([origin, this.session.destination]));
    if (requestId !== this.requestId) throw new Error("This recalculation was superseded by a newer navigation request.");
    this.publish({ ...this.session, revision: this.session.revision + 1, origin, route });
    return this.session;
  }

  startJourney(): NavigationSession {
    if (!this.session.route || !this.session.origin || !this.session.destination) throw new Error("Calculate a route before starting a journey.");
    if (this.session.status !== "ready" && this.session.status !== "paused") throw new Error("This journey is not ready to start.");
    this.publish({ ...this.session, status: "starting" });
    return this.session;
  }

  activateJourney(): NavigationSession {
    if (this.session.status !== "starting") throw new Error("A journey must be starting before it becomes active.");
    this.publish({ ...this.session, status: "active" });
    return this.session;
  }

  pauseJourney(): NavigationSession {
    if (this.session.status !== "active") throw new Error("Only an active journey can be paused.");
    this.publish({ ...this.session, status: "paused" });
    return this.session;
  }

  resumeJourney(): NavigationSession {
    if (this.session.status !== "paused") throw new Error("Only a paused journey can be resumed.");
    this.publish({ ...this.session, status: "active" });
    return this.session;
  }

  endJourney(): NavigationSession {
    if (!["ready", "starting", "active", "paused", "arrived", "error"].includes(this.session.status)) throw new Error("There is no journey to end.");
    this.publish({ ...this.session, status: "stopped" });
    return this.session;
  }

  markArrived(): NavigationSession {
    if (this.session.status !== "active") throw new Error("Only an active journey can arrive.");
    this.publish({ ...this.session, status: "arrived" });
    return this.session;
  }
}