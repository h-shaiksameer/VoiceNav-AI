import type { MapCommand } from "@/types/domain";
import { normalizeLanguage } from "./commands";

export type UiControlCommand = Omit<MapCommand, "id" | "location"> & { query?: string };
const levelWords = new Map<string, number>([
  ["zero", 0], ["one", 1], ["won", 1], ["two", 2], ["three", 3], ["tree", 3], ["four", 4], ["five", 5], ["six", 6], ["seven", 7], ["eight", 8], ["ate", 8], ["nine", 9], ["ten", 10], ["eleven", 11], ["twelve", 12],
]);
const levelToken = `(?:\\d+|${[...levelWords.keys()].join("|")})`;

function levelAmount(value: string | undefined): number {
  if (!value) return 1;
  const numeric = Number(value);
  return Math.max(1, Number.isNaN(numeric) ? levelWords.get(value.toLowerCase())! : numeric);
}

function cleanQuery(text: string): string {
  return text
    .replace(/^(?:please|kindly)\s+/iu, "")
    .replace(/^(?:at|around|on|to|near)\s+/iu, "")
    .replace(/^(?:(?:the\s+)?(?:map|view))(?:\s+(?:at|around|on|to|near)\s+)?/iu, "")
    .replace(/^(?:at|around|on|to|near)\s+/iu, "")
    .replace(/\s+(?:please|kindly|thanks|thank you)$/iu, "")
    .trim();
}

export function parseUiControlCommand(text: string): UiControlCommand | null {
  const clean = normalizeLanguage(text)
    .replace(/\bz(?:o+|u+)m\s*(?=(?:in|out)\b)/giu, "zoom ")
    .replace(/\bz(?:o+|u+)m(?=(?:\d|\s|$))/giu, "zoom")
    .replace(/\bmo+ve\b/giu, "move")
    .replace(/\b(?:inn+|in+|outt+)\b/giu, (word) => word.toLowerCase().startsWith("out") ? "out" : "in")
    .replace(/[.!?]+$/u, "")
    .trim();
  const zoomMatches = [...clean.matchAll(/\bzoom\b/giu)];
  const lastZoomIndex = zoomMatches.at(-1)?.index ?? 0;
  if (lastZoomIndex > 0) return parseUiControlCommand(clean.slice(lastZoomIndex));
  if (/^(?:please )?(?:reset|restore)(?: the)? map(?: view)?$/iu.test(clean)) return { action: "reset" };

  const zoom = clean.match(new RegExp(`^(?:please\\s+)?zoom(?:\\s+(in|out))?(?:\\s+(?:by\\s+)?(?:level\\s+)?(${levelToken})(?:\\s+levels?)?)?(?:\\s+(.+))?$`, "iu"));
  if (zoom) {
    const query = zoom[3] ? cleanQuery(zoom[3]) : "";
    const action = zoom[1]?.toLowerCase() === "out" ? "zoom-out" : "zoom-in";
    return query ? { action, amount: levelAmount(zoom[2]), query } : { action, amount: levelAmount(zoom[2]) };
  }

  const center = clean.match(/^(?:please )?(?:move|center|recenter)(?: the)? map(?: view)?\s+(?:to|at|on|near)\s+(.+)$/iu);
  if (center) return { action: "center", query: center[1].trim() };

  const pan = clean.match(new RegExp(`(?:^|.*\\s)((?:please\\s+)?(?:(?:move|shift)(?: the)?(?: map| view| screen)?|pan(?: the)?(?: map| view| screen)?)?\\s*(left|right|up(?:wards?)?|down(?:wards?)?)(?:\\s+(?:by\\s+)?(?:level\\s+)?(${levelToken})(?:\\s+levels?)?)?)(?:\\s+(?:please|now|thanks|thank you))?$`, "iu"));
  if (pan) {
    const direction = pan[2].toLowerCase().replace(/wards?$/u, "");
    return { action: `pan-${direction}` as UiControlCommand["action"], amount: levelAmount(pan[3]) };
  }
  return null;
}
