import type { Coordinates, NavigationAction, NavigationSession, RouteResult } from "@/types/domain";
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
    this.publish({ revision: this.session.revision + 1, status: "preview", origin, destination, route });
    return this.session;
  }
}