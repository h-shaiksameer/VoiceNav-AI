import type { TrackedLocation } from "@/types/domain";
import { distanceBetween } from "@/utils/geo";

export type MovementState = "STATIONARY" | "MOVING" | "UNKNOWN";

export class MovementDetectionService {
  private previous: TrackedLocation | null = null;

  update(location: TrackedLocation): MovementState {
    if (!this.previous) { this.previous = location; return "UNKNOWN"; }
    const elapsedSeconds = (location.timestamp - this.previous.timestamp) / 1000;
    const distanceMeters = distanceBetween(this.previous, location);
    const averageAccuracy = (this.previous.accuracyMeters + location.accuracyMeters) / 2;
    this.previous = location;
    if (elapsedSeconds <= 0 || elapsedSeconds > 300 || location.accuracyMeters > 100) return "UNKNOWN";
    const minimumMovement = Math.max(12, Math.min(35, averageAccuracy));
    return distanceMeters >= minimumMovement ? "MOVING" : "STATIONARY";
  }

  reset(): void { this.previous = null; }
}