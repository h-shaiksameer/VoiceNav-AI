import type { Intent, IntentType } from "@/types/domain";

const clearsPendingIntents = new Set<IntentType>([
  "PLAN_ROUTE",
  "CHANGE_DESTINATION",
  "STOP_NAVIGATION",
  "SEARCH_NEARBY",
  "SEARCH_ALONG_ROUTE",
]);

export function clearsPendingNavigation(intent: Intent): boolean {
  return clearsPendingIntents.has(intent.type);
}