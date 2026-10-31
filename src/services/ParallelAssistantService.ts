import type { AssistantQuerySnapshot, NavigationSession } from "@/types/domain";

export type AssistantResponder = (query: string, session: NavigationSession, signal: AbortSignal) => Promise<string>;

export class ParallelAssistantService {
  private requestId = 0;
  private controller: AbortController | null = null;
  private snapshot: AssistantQuerySnapshot = { requestId: 0, status: "idle", query: "", answer: null, error: null, routeRevision: 0 };
  private listeners = new Set<() => void>();

  constructor(private readonly respond: AssistantResponder) {}

  getSnapshot = (): AssistantQuerySnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(snapshot: AssistantQuerySnapshot): void {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
  }

  async ask(query: string, session: NavigationSession): Promise<string | null> {
    const clean = query.trim().slice(0, 500);
    if (!clean) return null;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const requestId = ++this.requestId;
    this.publish({ requestId, status: "running", query: clean, answer: null, error: null, routeRevision: session.revision });
    try {
      const answer = await this.respond(clean, session, controller.signal);
      if (requestId !== this.requestId || controller.signal.aborted) return null;
      this.publish({ requestId, status: "complete", query: clean, answer, error: null, routeRevision: session.revision });
      return answer;
    } catch (error) {
      if (requestId !== this.requestId || controller.signal.aborted) return null;
      const message = error instanceof Error ? error.message : "The assistant request failed.";
      this.publish({ requestId, status: "error", query: clean, answer: null, error: message, routeRevision: session.revision });
      throw error;
    }
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.snapshot.status === "running") this.publish({ ...this.snapshot, status: "cancelled" });
  }
}