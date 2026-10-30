import type { NavigationSession } from "@/types/domain";

export const emptySession = (): NavigationSession => ({ revision: 0, status: "idle", origin: null, destination: null, route: null });