import type { Coordinates } from "@/types/domain";

export function validCoordinates(value: Coordinates): boolean {
  return Number.isFinite(value.lat) && Number.isFinite(value.lon) && Math.abs(value.lat) <= 90 && Math.abs(value.lon) <= 180;
}

export function distanceBetween(first: Coordinates, second: Coordinates): number {
  const radians = Math.PI / 180;
  const latitude = (second.lat - first.lat) * radians;
  const longitude = (second.lon - first.lon) * radians;
  const arc = Math.sin(latitude / 2) ** 2 + Math.cos(first.lat * radians) * Math.cos(second.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(Math.max(0, 1 - arc)));
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`;
}